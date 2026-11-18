import { Suspense } from "react";

import { FunnelBars } from "@/components/charts/FunnelBars";
import { FunnelHeatTable, type HeatRow } from "@/components/charts/FunnelHeatTable";
import { StepsEditor } from "@/components/funnel/StepsEditor";
import { DashboardShell } from "@/components/shell/DashboardShell";
import { DataTable, type ColumnSpec, type TableRow } from "@/components/table/DataTable";
import { MetaNotice } from "@/components/ui/MetaNotice";
import { Card, ErrorBlock, KpiStrip, KpiTile, Notice, PageHeader, Skeleton } from "@/components/ui/primitives";
import { SectionTabs } from "@/components/ui/SectionTabs";
import { EVENT_LABELS, FUNNEL_BREAKDOWNS, JOURNEY, SIMULATOR_LABELS } from "@/config/cro";
import { fmtInt, fmtPct, fmtRange } from "@/lib/format";
import { journeyExits, journeyStableSince, journeySteps } from "@/lib/ga4/briefing";
import { buildContext, type PageContext } from "@/lib/ga4/context";
import { runFunnel, type FunnelStepDef } from "@/lib/ga4/funnel";
import { getMetadata } from "@/lib/ga4/metadata";
import { eq, inList, runReport, settle } from "@/lib/ga4/report";
import { compareWith, type SearchParams } from "@/lib/state";
import { disconnectedSteps, eventUsers } from "@/lib/quality";
import { defaultFunnel, inventory90 } from "@/lib/views";

type Mode = "jornada" | "eventos";
type Breakdown = { id: string; label: string };

const MODES = [
  { id: "jornada", label: "Jornada do simulador" },
  { id: "eventos", label: "Funil por eventos" },
];

/** Nome legível do segmento (o subdomínio do simulador vira o nome do simulador). */
const segmentName = (breakdown: string, value: string) =>
  breakdown === "hostName" ? (SIMULATOR_LABELS[value] ?? value) : value === "(not set)" ? "(sem valor)" : value;

/**
 * Funil de conversão em dois modos. Jornada: as telas do simulador, lidas de um evento macro com
 * parâmetro de etapa (só quando a propriedade tem esse evento). Eventos: funil fechado editável,
 * com as etapas na URL (?etapas). Os dois saem do runFunnelReport do GA4.
 */
export default async function FunnelPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const page = buildContext(sp);
  const [md, journey] = await Promise.all([
    getMetadata(page.ctx.propertyId).catch(() => null),
    journeySteps(page.ctx).catch(() => null),
  ]);
  const mode: Mode = journey && sp.funil !== "eventos" ? "jornada" : "eventos";
  const breakdowns = FUNNEL_BREAKDOWNS.filter((b) => md?.dimensions.has(b.id));
  const breakdown = breakdowns.find((b) => b.id === sp.quebra)?.id ?? breakdowns[0]?.id ?? "platform";
  const modeTabs = journey ? <SectionTabs param="funil" label="Tipo de funil" options={MODES} current={mode} /> : null;

  if (mode === "jornada" && journey) {
    return (
      <DashboardShell page={page} section="funil">
        <PageHeader
          title="Funil de conversão"
          description="A jornada do simulador tela a tela: quantos entram, quantos avançam e onde abandonam. Os filtros de campanha, origem e canal no topo recortam o funil inteiro."
        />
        <div className="grid gap-5 2xl:gap-6 min-[100rem]:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-5 2xl:space-y-6">
            <Suspense fallback={<Skeleton className="h-[560px]" />}>
              <JourneyFunnel page={page} steps={journey} tabs={modeTabs} />
            </Suspense>
            <Suspense fallback={<Skeleton className="h-96" />}>
              <JourneyBreakdown page={page} steps={journey} breakdown={breakdown} breakdowns={breakdowns} />
            </Suspense>
            <Suspense fallback={<Skeleton className="h-64" />}>
              <JourneyVolumes page={page} steps={journey} />
            </Suspense>
          </div>
          <JourneyHelp steps={journey} />
        </div>
      </DashboardShell>
    );
  }

  const { steps: defaults, removed } = await defaultFunnel(page.ctx);
  // Etapas pela URL: no máximo 10; sem elas vale o funil padrão da propriedade.
  const custom = typeof sp.etapas === "string" ? sp.etapas.split(",").filter(Boolean).slice(0, 10) : null;
  const steps: FunnelStepDef[] = custom ? custom.map((e) => ({ event: e, label: EVENT_LABELS[e] ?? e })) : defaults;
  const events = await inventory90(page.ctx).catch(() => []);

  return (
    <DashboardShell page={page} section="funil">
      <PageHeader
        title="Funil de conversão"
        description="Usuários que passaram por cada evento, em sequência (funil fechado do GA4): quantos seguem, quantos abandonam e onde está a maior perda."
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          {!custom && removed.length > 0 && (
            <Notice title="Etapas sem dados foram removidas">
              {removed.map((r) => r.event).join(", ")} não tem nenhum evento nos últimos 90 dias nesta propriedade, então
              ficou fora do funil.
            </Notice>
          )}
          <Suspense fallback={<Skeleton className="h-96" />}>
            <FunnelBlock page={page} steps={steps} tabs={modeTabs} />
          </Suspense>
          <Suspense fallback={<Skeleton className="h-64" />}>
            <BreakdownBlock page={page} steps={steps} breakdown={breakdown} breakdowns={breakdowns} />
          </Suspense>
          <Suspense fallback={<Skeleton className="h-56" />}>
            <EventVolumes page={page} steps={steps} />
          </Suspense>
        </div>
        <Card
          title="Etapas do funil"
          subtitle="Monte o funil com qualquer evento da propriedade (ordenados por volume em 90 dias)."
          className="no-export h-fit"
        >
          <StepsEditor
            key={steps.map((s) => s.event).join(",")}
            steps={steps.map((s) => s.event)}
            defaultSteps={defaults.map((s) => s.event)}
            events={events.filter((e) => e.count > 0).slice(0, 200)}
          />
        </Card>
      </div>
    </DashboardShell>
  );
}

// ---------------------------------------------------------------------------
// Jornada do simulador (evento macro + parâmetro)
// ---------------------------------------------------------------------------

/** Indicadores e funil fechado da jornada, com as telas de saída marcadas na etapa em que acontecem. */
async function JourneyFunnel({ page, steps, tabs }: { page: PageContext; steps: FunnelStepDef[]; tabs: React.ReactNode }) {
  const { ctx } = page;
  const [cur, prev, exits, site, since] = await Promise.all([
    settle(runFunnel(ctx, steps)),
    ctx.comparison ? settle(runFunnel(ctx, steps, { range: ctx.comparison })) : null,
    settle(journeyExits(ctx)),
    settle(runReport(ctx, { metrics: ["totalUsers", "sessions"] })),
    journeyStableSince(ctx).catch(() => null),
  ]);
  if (!cur.ok) {
    return (
      <Card title="Funil da jornada" actions={tabs}>
        <ErrorBlock message={cur.error} />
      </Card>
    );
  }
  const total = cur.data.total.steps;
  const prevSteps = prev?.ok ? prev.data.total.steps : undefined;
  const siteRow = site.ok ? site.data.rows[0] : undefined;
  const siteUsers = siteRow?.cur.totalUsers ?? 0;
  const prevSiteUsers = siteRow?.prev?.totalUsers;
  const started = total[0]?.users ?? 0;
  const finished = total.at(-1)?.users ?? 0;
  const prevStarted = prevSteps?.[0]?.users;
  const prevFinished = prevSteps?.at(-1)?.users;
  const completion = started ? finished / started : 0;
  const prevCompletion = prevStarted ? (prevFinished ?? 0) / prevStarted : undefined;
  // Saída cuja etapa anterior não está no funil fica fora do gráfico.
  const exitMarks = exits.ok
    ? exits.data
        .map((x) => ({ afterIndex: steps.findIndex((s) => s.param?.value === x.after), label: x.label, users: x.users }))
        .filter((x) => x.afterIndex >= 0)
    : [];
  const vs = ctx.comparison ? compareWith(page.state) : undefined;
  const br = (iso: string) => iso.split("-").reverse().join("/");
  // Período que começa antes de o evento chegar todo dia fica incompleto (e infla a variação).
  const partialPrev = Boolean(since && ctx.comparison && ctx.comparison.start < since);
  const partialCur = Boolean(since && ctx.current.start < since);

  return (
    <div className="space-y-5 2xl:space-y-6">
      {since && (partialPrev || partialCur) && (
        <Notice tone="warning" title={`O evento ${JOURNEY.event} só chega todos os dias desde ${br(since)}`}>
          Antes dessa data o evento tem dias zerados ou quase zerados (implantação ou falha de envio), então{" "}
          {partialPrev && partialCur
            ? "os dois períodos ficam incompletos"
            : partialPrev
              ? `a variação contra ${vs} sai inflada e não mede mudança real`
              : "o período atual fica incompleto"}
          . Para comparar a jornada, use períodos a partir de {br(since)}.
        </Notice>
      )}
      <KpiStrip count={4}>
        <KpiTile label="Usuários no site" value={siteUsers} prev={ctx.comparison ? prevSiteUsers : undefined} format="int" note="Volume de entrada do recorte" />
        <KpiTile
          label="Iniciaram a simulação"
          value={started}
          prev={ctx.comparison ? prevStarted : undefined}
          format="int"
          note={siteUsers ? `${fmtPct(started / siteUsers, 1)} de quem entrou no site` : undefined}
        />
        <KpiTile label={`Chegaram em "${total.at(-1)?.label}"`} value={finished} prev={ctx.comparison ? prevFinished : undefined} format="int" />
        <KpiTile
          label="Conclusão da simulação"
          value={completion}
          prev={ctx.comparison ? prevCompletion : undefined}
          format="pct"
          note="Última etapa ÷ início da simulação"
        />
      </KpiStrip>
      <Card
        title="Funil da jornada"
        subtitle={`${fmtRange(ctx.current)} · usuários que passaram por cada tela, em sequência${vs ? `. A variação da passagem é contra ${vs}` : ""}.`}
        actions={tabs}
      >
        {cur.data.method === "fallback" && (
          <div className="mb-4">
            <Notice tone="warning" title="Funil calculado por usuários por etapa">
              O relatório de funil do GA4 não respondeu, então cada etapa mostra os usuários que viram a tela no período, sem
              garantir a sequência. Motivo: {cur.data.fallbackReason}
            </Notice>
          </div>
        )}
        <FunnelBars steps={total} prev={prevSteps} exits={exitMarks} />
      </Card>
    </div>
  );
}

/** Jornada quebrada por segmento (até 12) num mapa de calor, com quantos de cada segmento iniciam a simulação. */
async function JourneyBreakdown({
  page,
  steps,
  breakdown,
  breakdowns,
}: {
  page: PageContext;
  steps: FunnelStepDef[];
  breakdown: string;
  breakdowns: Breakdown[];
}) {
  // Usuários do site por segmento: base da taxa de início de cada linha.
  const [res, site] = await Promise.all([
    settle(runFunnel(page.ctx, steps, { breakdown, breakdownLimit: 12 })),
    settle(runReport(page.ctx, { dimensions: [breakdown], metrics: ["totalUsers"], compare: false, orderBy: { metric: "totalUsers" }, limit: 500 })),
  ]);
  const label = breakdowns.find((b) => b.id === breakdown)?.label ?? breakdown;
  const tabs = <SectionTabs param="quebra" label="Quebrar funil por" options={breakdowns} current={breakdown} />;
  if (!res.ok) {
    return (
      <Card title="Funil por segmento" actions={tabs}>
        <ErrorBlock message={res.error} />
      </Card>
    );
  }
  const siteBy = new Map(site.ok ? site.data.rows.map((r) => [r.dims[breakdown], r.cur.totalUsers ?? 0]) : []);
  const siteTotal = site.ok ? site.data.rows.reduce((n, r) => n + (r.cur.totalUsers ?? 0), 0) : undefined;
  const rows: HeatRow[] = res.data.segments
    .filter((s) => s.steps[0].users > 0)
    .map((s) => ({
      segment: segmentName(breakdown, s.segment),
      siteUsers: site.ok ? siteBy.get(s.segment) : undefined,
      users: s.steps.map((x) => x.users),
    }));
  return (
    <Card
      title={`Funil por ${label.toLowerCase()}`}
      subtitle="Cada célula mostra quanto de quem iniciou a simulação chegou na etapa; quanto mais escuro, mais gente. O traço laranja marca a maior perda da linha."
      actions={tabs}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-ink-2">Sem segmentos com usuários no funil neste recorte.</p>
      ) : (
        <FunnelHeatTable
          steps={steps.map((s) => s.label)}
          segmentLabel={label}
          total={{ segment: "Total", siteUsers: siteTotal, users: res.data.total.steps.map((x) => x.users) }}
          rows={rows}
        />
      )}
      <p className="mt-3 text-xs text-muted">
        Mostra os {rows.length} segmentos com mais usuários na primeira etapa. Para ver o funil de um segmento só, filtre pelo topo
        da página.
      </p>
    </Card>
  );
}

/** Contagem bruta do evento macro por valor do parâmetro de etapa, inclusive valores que o funil não usa. */
async function JourneyVolumes({ page, steps }: { page: PageContext; steps: FunnelStepDef[] }) {
  const dim = `customEvent:${JOURNEY.param}`;
  const res = await settle(
    runReport(page.ctx, {
      dimensions: [dim],
      metrics: ["eventCount", "totalUsers", "sessions"],
      where: eq("eventName", JOURNEY.event),
      limit: 200,
    }),
  );
  if (!res.ok) return <ErrorBlock message={res.error} />;
  // Casa os valores sem diferenciar maiúsculas, já que o parâmetro pode chegar com outra caixa.
  const byValue = new Map(res.data.rows.map((r) => [r.dims[dim].toLowerCase(), r]));
  const known = new Set([...steps.map((s) => s.param!.value.toLowerCase()), ...JOURNEY.exits.map((x) => x.value.toLowerCase())]);
  const toRow = (id: string, label: string, value: string, kind: string, flags: TableRow["flags"] = []): TableRow => {
    const r = byValue.get(value.toLowerCase());
    return {
      id,
      values: {
        step: label,
        value,
        kind,
        eventCount: r?.cur.eventCount ?? 0,
        totalUsers: r?.cur.totalUsers ?? 0,
        perUser: r?.cur.totalUsers ? (r.cur.eventCount ?? 0) / r.cur.totalUsers : 0,
      },
      prev: r?.prev ? { eventCount: r.prev.eventCount, totalUsers: r.prev.totalUsers } : undefined,
      flags,
    };
  };
  const rows: TableRow[] = [
    ...steps.map((s, i) => toRow(s.param!.value, `${i + 1}. ${s.label}`, s.param!.value, "Etapa")),
    ...JOURNEY.exits.map((x) => toRow(x.value, x.label, x.value, "Saída", [{ label: "Tela de saída", tone: "warning" }])),
    ...res.data.rows
      .filter((r) => !known.has(r.dims[dim].toLowerCase()) && (r.cur.eventCount ?? 0) > 0)
      .map((r) =>
        toRow(r.dims[dim], r.dims[dim] === "(not set)" ? "(sem nome da etapa)" : r.dims[dim], r.dims[dim], "Fora do funil", [
          { label: "Valor não mapeado", tone: "info" },
        ]),
      ),
  ];
  return (
    <Card
      title={`Volume de ${JOURNEY.event} por etapa`}
      subtitle={`Contagem bruta do evento macro por valor de ${JOURNEY.param} (sem exigir sequência). Valores não mapeados ficam no fim da lista.`}
    >
      <MetaNotice meta={res.data.meta} />
      <DataTable
        filename="funil-jornada-eventos"
        searchable={false}
        pageSize={25}
        columns={[
          { key: "step", label: "Tela", type: "dim" },
          { key: "value", label: JOURNEY.param, type: "dim" },
          { key: "kind", label: "Tipo", type: "dim" },
          { key: "eventCount", label: "Eventos", type: "metric", format: "int", delta: true },
          { key: "totalUsers", label: "Usuários", type: "metric", format: "int", bar: true, delta: true },
          { key: "perUser", label: "Eventos por usuário", type: "metric", format: "decimal" },
        ]}
        rows={rows}
      />
    </Card>
  );
}

/** Painel lateral que explica como a jornada vira funil e lista as etapas na ordem. */
function JourneyHelp({ steps }: { steps: FunnelStepDef[] }) {
  return (
    <Card title="Como o funil é montado" className="h-fit">
      <div className="space-y-4 text-[0.8125rem] leading-relaxed text-ink-2">
        <p>
          Cada etapa é o evento macro <code className="rounded bg-raised px-1 py-0.5 text-ink">{JOURNEY.event}</code> com um valor
          do parâmetro <code className="rounded bg-raised px-1 py-0.5 text-ink">{JOURNEY.param}</code>, na ordem das telas do
          simulador. O funil é fechado: só conta quem passou pelas etapas anteriores.
        </p>
        <ol className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3 min-[100rem]:grid-cols-1">
          {steps.map((s, i) => (
            <li key={s.param!.value} className="flex gap-2.5">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-raised text-[0.6875rem] font-semibold text-ink tabular">
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-ink">{s.label}</span>
                <span className="block truncate text-xs text-muted">{s.param!.value}</span>
              </span>
            </li>
          ))}
        </ol>
        {JOURNEY.exits.length > 0 && (
          <p>
            Telas de saída ({JOURNEY.exits.map((x) => `"${x.value}"`).join(", ")}) não são etapas: aparecem abaixo da etapa em
            que acontecem e explicam parte do abandono.
          </p>
        )}
        <p>
          A conversão final (lead e compra) fica na Visão geral: a compra chega pelo servidor e não se liga às telas do
          simulador.
        </p>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Funil por eventos (editável)
// ---------------------------------------------------------------------------

/** Funil fechado por eventos, com aviso de etapa desconectada (evento sem ligação com a navegação anterior). */
async function FunnelBlock({ page, steps, tabs }: { page: PageContext; steps: FunnelStepDef[]; tabs: React.ReactNode }) {
  const { ctx } = page;
  const [cur, prev, users] = await Promise.all([
    settle(runFunnel(ctx, steps)),
    ctx.comparison ? settle(runFunnel(ctx, steps, { range: ctx.comparison })) : null,
    settle(eventUsers(ctx, steps.map((s) => s.event))),
  ]);
  if (!cur.ok) {
    return (
      <Card title="Funil do período" actions={tabs}>
        <ErrorBlock message={cur.error} />
      </Card>
    );
  }
  const f = cur.data;
  // Desconexão só se mede no funil de verdade: no fallback não há sequência para comparar.
  const cut = f.method === "funnel" && users.ok ? disconnectedSteps(f.total.steps, users.data) : [];
  const total = f.total.steps;
  // Mede a conversão até a última etapa ligada: depois de uma etapa desconectada o funil não é confiável.
  const end = cut.length ? Math.min(...cut) - 1 : total.length - 1;
  const overall = total[0]?.users ? total[end].users / total[0].users : 0;
  const prevSteps = prev?.ok ? prev.data.total.steps : null;
  const prevOverall = prevSteps?.[0]?.users ? prevSteps[end].users / prevSteps[0].users : null;

  return (
    <Card
      title="Funil do período"
      subtitle={`${fmtRange(ctx.current)} · ${fmtPct(overall)} de quem entra na primeira etapa chega ${
        end === total.length - 1 ? "à última" : `a "${total[end].label}" (última etapa ligada)`
      }${prevOverall !== null ? ` (antes: ${fmtPct(prevOverall)})` : ""}`}
      actions={tabs}
    >
      {f.method === "fallback" && (
        <div className="mb-4">
          <Notice tone="warning" title="Funil calculado por usuários por evento">
            O runFunnelReport (v1alpha) não respondeu, então cada etapa mostra os usuários que dispararam o evento no
            período, sem garantir a sequência. Motivo: {f.fallbackReason}
          </Notice>
        </div>
      )}
      {cut.length > 0 && users.ok && (
        <div className="mb-4">
          <Notice tone="critical" title={`Etapa desconectada: ${cut.map((i) => total[i].label).join(", ")}`}>
            {cut.map((i) => (
              <span key={i} className="block">
                {fmtInt(users.data.get(total[i].event) ?? 0)} usuários dispararam {total[i].event} no período, mas só{" "}
                {fmtInt(total[i].users)} chegam nessa etapa vindo de &quot;{total[i - 1].label}&quot;.
              </span>
            ))}
            O evento chega sem ligação com a navegação de quem passou pelas etapas anteriores (em geral, enviado pelo servidor
            sem o ID do navegador). A queda nessa passagem não é abandono real; o funil confiável vai até a etapa anterior.
          </Notice>
        </div>
      )}
      <FunnelBars steps={total} prev={prev?.ok ? prev.data.total.steps : undefined} disconnected={cut} />
    </Card>
  );
}

/** Funil por eventos quebrado por segmento: usuários em cada etapa e taxa de passagem entre elas. */
async function BreakdownBlock({
  page,
  steps,
  breakdown,
  breakdowns,
}: {
  page: PageContext;
  steps: FunnelStepDef[];
  breakdown: string;
  breakdowns: Breakdown[];
}) {
  const res = await settle(runFunnel(page.ctx, steps, { breakdown, breakdownLimit: 12 }));
  const label = breakdowns.find((b) => b.id === breakdown)?.label ?? breakdown;
  const tabs = <SectionTabs param="quebra" label="Quebrar funil por" options={breakdowns} current={breakdown} />;
  if (!res.ok) {
    return (
      <Card title="Funil por segmento" actions={tabs}>
        <ErrorBlock message={res.error} />
      </Card>
    );
  }
  const f = res.data;
  const overall = f.total.steps[0]?.users ? f.total.steps.at(-1)!.users / f.total.steps[0].users : 0;
  const columns: ColumnSpec[] = [
    { key: "segment", label, type: "dim" },
    ...steps.map((s, i) => ({ key: `s${i}`, label: s.label, type: "metric" as const, format: "int" as const })),
    ...steps.slice(0, -1).map((s, i) => ({
      key: `p${i}`,
      label: `${i + 1}→${i + 2}`,
      type: "metric" as const,
      format: "pct" as const,
      help: `Passagem de ${s.label} para ${steps[i + 1].label}`,
    })),
    { key: "rate", label: "1ª→última", type: "metric", format: "pct", bar: true },
  ];
  const rows: TableRow[] = f.segments.map((seg) => {
    const first = seg.steps[0]?.users ?? 0;
    const rate = first ? seg.steps.at(-1)!.users / first : 0;
    const values: TableRow["values"] = { segment: segmentName(breakdown, seg.segment), rate };
    seg.steps.forEach((s, i) => {
      values[`s${i}`] = s.users;
      if (s.nextRate !== null) values[`p${i}`] = s.nextRate;
    });
    // Sinaliza segmento com 50+ usuários na entrada e conversão abaixo de 60% da do total.
    const flags: TableRow["flags"] =
      first >= 50 && overall > 0 && rate < overall * 0.6
        ? [{ label: `${fmtPct(1 - rate / overall, 0)} abaixo do total`, tone: "critical" }]
        : [];
    return { id: seg.segment, values, flags };
  });

  return (
    <Card title="Funil por segmento" subtitle="Usuários em cada etapa e taxa de passagem entre etapas." actions={tabs}>
      <DataTable filename={`funil-por-${breakdown}`} columns={columns} rows={rows} initialSort={{ key: "s0" }} searchable={false} />
    </Card>
  );
}

/** Contagem bruta de cada evento do funil, para achar etapa com mais volume que a anterior. */
async function EventVolumes({ page, steps }: { page: PageContext; steps: FunnelStepDef[] }) {
  const res = await settle(
    runReport(page.ctx, {
      dimensions: ["eventName"],
      metrics: ["eventCount", "totalUsers"],
      where: inList("eventName", steps.map((s) => s.event)),
    }),
  );
  if (!res.ok) return <ErrorBlock message={res.error} />;
  const byEvent = new Map(res.data.rows.map((r) => [r.dims.eventName, r]));
  const rows: TableRow[] = steps.map((s, i) => {
    const r = byEvent.get(s.event);
    const prevStep = i > 0 ? byEvent.get(steps[i - 1].event) : undefined;
    const flags: TableRow["flags"] = [];
    if (r && prevStep && r.cur.totalUsers > prevStep.cur.totalUsers) {
      flags.push({ label: "Mais usuários que a etapa anterior", tone: "warning" });
    }
    // Folga de 2% nos eventos para diferença pequena de contagem não virar alerta.
    if (r && prevStep && r.cur.eventCount > prevStep.cur.eventCount * 1.02) {
      flags.push({ label: "Mais eventos que a etapa anterior", tone: "warning" });
    }
    // Mais de 3 compras por usuário costuma ser disparo repetido do purchase.
    if (r && r.cur.totalUsers && r.cur.eventCount / r.cur.totalUsers > 3 && s.event === "purchase") {
      flags.push({ label: "Muitas compras por usuário", tone: "info" });
    }
    return {
      id: s.event,
      values: {
        step: `${i + 1}. ${s.label}`,
        event: s.event,
        eventCount: r?.cur.eventCount ?? 0,
        totalUsers: r?.cur.totalUsers ?? 0,
        perUser: r?.cur.totalUsers ? (r.cur.eventCount ?? 0) / r.cur.totalUsers : 0,
      },
      prev: r?.prev ? { eventCount: r.prev.eventCount, totalUsers: r.prev.totalUsers } : undefined,
      flags,
    };
  });
  return (
    <Card
      title="Volume de eventos das etapas"
      subtitle="Contagem bruta (não sequencial). Etapa com mais volume que a anterior indica tracking incoerente ou caminho alternativo."
    >
      <MetaNotice meta={res.data.meta} />
      <DataTable
        filename="funil-eventos"
        searchable={false}
        columns={[
          { key: "step", label: "Etapa", type: "dim" },
          { key: "event", label: "Evento", type: "dim" },
          { key: "eventCount", label: "Eventos", type: "metric", format: "int", delta: true },
          { key: "totalUsers", label: "Usuários", type: "metric", format: "int", delta: true },
          { key: "perUser", label: "Eventos por usuário", type: "metric", format: "decimal" },
        ]}
        rows={rows}
      />
    </Card>
  );
}

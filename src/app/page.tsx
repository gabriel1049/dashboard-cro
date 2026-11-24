import { ArrowRight, CircleCheck, CircleExclamationPoint, Info, OctagonExclamationPoint } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { TimeSeriesChart, type SeriesMetric, type SeriesPoint } from "@/components/charts/TimeSeriesChart";
import { DashboardShell } from "@/components/shell/DashboardShell";
import { DataTable } from "@/components/table/DataTable";
import { CardFrame, ExportData, ExportMenu } from "@/components/ui/CardExport";
import { LeadCoverageNotice } from "@/components/ui/LeadNotice";
import { MetaNotice } from "@/components/ui/MetaNotice";
import { Card, ErrorBlock, KpiCard, KpiStrip, KpiTile, PageHeader, Skeleton, type Tone } from "@/components/ui/primitives";
import { CATEGORIES } from "@/lib/categories";
import { GoalButton } from "@/components/ui/GoalButton";
import { fmtBRL, fmtCompact, fmtInt, fmtPct, fmtRange, type FormatKind } from "@/lib/format";
import { aggRate, categoryReport, journeySteps, profileHighlights, profileReport } from "@/lib/ga4/briefing";
import { buildContext, type PageContext } from "@/lib/ga4/context";
import { runFunnel } from "@/lib/ga4/funnel";
import {
  conversionOf,
  cro,
  croByDimension,
  croMetrics,
  effectiveGoal,
  getTerms,
  leadAvailable,
  leadEvent,
} from "@/lib/ga4/kpis";
import { mergeMeta, runReport, settle, type QueryContext } from "@/lib/ga4/report";
import { buildInsights } from "@/lib/insights";
import { ATTRIBUTION_ALERT, purchaseAttribution, purchaseMeasurementShift } from "@/lib/quality";
import { addDays, compareLabel, compareWith, serializeState, type Range, type SearchParams } from "@/lib/state";
import { croColumns, croRow, defaultFunnel } from "@/lib/views";

/**
 * Visão geral: indicadores do período, evolução diária, um resumo de cada análise do briefing
 * (funil, perfil, campanhas e categorias) e os alertas. Tudo vem da Data API do GA4; cada bloco
 * tem o seu Suspense e falha sozinho, sem derrubar a página.
 */
export default async function OverviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = buildContext(await searchParams);
  const vs = page.ctx.comparison ? compareWith(page.state) : null;
  return (
    <DashboardShell page={page} section="visao-geral">
      <PageHeader
        title="Visão geral"
        description={`Os indicadores gerais do período${vs ? `, com a variação contra ${vs}` : ""}, e um resumo de cada análise: perfil, funil, campanhas e categorias.`}
      />
      <div className="space-y-5 2xl:space-y-6">
        <Suspense fallback={<Skeleton className="h-64" />}>
          <Headline page={page} />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Trend page={page} />
        </Suspense>
        <div className="grid gap-5 lg:grid-cols-2 2xl:gap-6 min-[112.5rem]:grid-cols-4">
          <Suspense fallback={<Skeleton className="h-80" />}>
            <FunnelPreview page={page} />
          </Suspense>
          <Suspense fallback={<Skeleton className="h-80" />}>
            <ProfilePreview page={page} />
          </Suspense>
          <Suspense fallback={<Skeleton className="h-80" />}>
            <CampaignPreview page={page} />
          </Suspense>
          <Suspense fallback={<Skeleton className="h-80" />}>
            <CategoryPreview page={page} />
          </Suspense>
        </div>
        <Suspense fallback={<Skeleton className="h-48" />}>
          <Insights page={page} />
        </Suspense>
        <Suspense fallback={null}>
          <Platforms page={page} />
        </Suspense>
      </div>
    </DashboardShell>
  );
}

// ---------------------------------------------------------------------------
// Dados diários compartilhados (cartões e tendência usam a mesma consulta, que fica em cache)
// ---------------------------------------------------------------------------

/**
 * Métricas da meta efetiva, mais eventCount e a contagem de lead quando o lead é evento-chave.
 * Se a checagem do lead falhar, o painel segue só com compra.
 */
async function baseMetrics(ctx: QueryContext) {
  const [{ metrics, src, terms }, hasLead] = await Promise.all([croMetrics(ctx), leadAvailable(ctx.propertyId).catch(() => false)]);
  const leadMetric = `keyEvents:${leadEvent()}`;
  const all = [...new Set([...metrics, "eventCount", ...(hasLead ? [leadMetric] : [])])];
  return { all, src, terms, hasLead, leadMetric };
}

/**
 * Completa o período com os dias que o GA4 não devolveu, para o gráfico não pular datas.
 * A chave segue o formato da dimensão date do GA4 (AAAAMMDD).
 */
function fillDays(range: Range, rows: { date: string; values: Record<string, number> }[]): SeriesPoint[] {
  const byDate = new Map(rows.map((r) => [r.date, r.values]));
  const out: SeriesPoint[] = [];
  for (let d = range.start; d <= range.end; d = addDays(d, 1)) {
    const key = d.replaceAll("-", "");
    out.push({ date: key, values: byDate.get(key) ?? {} });
  }
  return out;
}

/** Série diária de um período com tudo que os cartões e o gráfico de evolução mostram. */
async function loadDaily(ctx: QueryContext, range: Range) {
  const { all, src, leadMetric } = await baseMetrics(ctx);
  // Uma linha por dia: o limite de 800 cobre mais de dois anos.
  const r = await runReport(ctx, { dimensions: ["date"], metrics: all, range, orderBy: { dimension: "date" }, limit: 800 });
  const rows = r.rows.map((row) => {
    const c = cro(row.cur, src);
    return {
      date: row.dims.date,
      values: {
        events: row.cur.eventCount ?? 0,
        sessions: c.sessions,
        users: c.users,
        conversion: conversionOf(row.cur, src),
        goals: c.goals,
        purchases: c.purchases,
        leads: row.cur[leadMetric] ?? 0,
        revenue: c.revenue,
      },
    };
  });
  return { points: fillDays(range, rows), meta: r.meta };
}

// ---------------------------------------------------------------------------
// Indicadores gerais
// ---------------------------------------------------------------------------

/** Cartões do topo, com minigráfico do período, e a faixa de indicadores secundários. */
async function Headline({ page }: { page: PageContext }) {
  const { ctx } = page;
  const res = await settle(
    (async () => {
      const [{ all, src, terms, hasLead, leadMetric }, shift] = await Promise.all([
        baseMetrics(ctx),
        purchaseMeasurementShift(ctx).catch(() => null),
      ]);
      const [report, cur, prev] = await Promise.all([
        runReport(ctx, { metrics: all }),
        loadDaily(ctx, ctx.current),
        ctx.comparison ? loadDaily(ctx, ctx.comparison) : null,
      ]);
      const row = report.rows[0];
      return {
        cur: { ...cro(row?.cur, src), events: row?.cur.eventCount ?? 0, leads: row?.cur[leadMetric] ?? 0 },
        prev: row?.prev ? { ...cro(row.prev, src), events: row.prev.eventCount ?? 0, leads: row.prev[leadMetric] ?? 0 } : undefined,
        daily: cur.points,
        prevDaily: prev?.points,
        meta: report.meta,
        src,
        terms,
        hasLead,
        shift,
      };
    })(),
  );
  if (!res.ok) return <ErrorBlock message={res.error} />;
  const { cur, prev, daily, prevDaily, meta, src, terms, hasLead, shift } = res.data;
  const vs = ctx.comparison ? compareLabel(page.state) : undefined;
  const spark = (k: string) => daily.map((p) => p.values[k] ?? 0);
  const prevSpark = (k: string) => prevDaily?.map((p) => p.values[k] ?? 0);
  // Compra medida de outro jeito em cada período: as variações do que depende de compra não valem.
  const changed = shift
    ? `A medição de compras mudou entre os períodos (compras sem origem: ${fmtPct(shift.prev.share, 0)} antes, ${fmtPct(shift.cur.share, 0)} agora). A variação não mede mudança real.`
    : undefined;
  // CSV do bloco: um indicador por linha, com o período de comparação e a variação.
  const kpis: { label: string; cur: number; prev?: number; unit: string }[] = [
    { label: "Total de eventos", cur: cur.events, prev: prev?.events, unit: "número" },
    { label: "Total de sessões", cur: cur.sessions, prev: prev?.sessions, unit: "número" },
    { label: "Compras", cur: cur.purchases, prev: prev?.purchases, unit: "número" },
    ...(hasLead ? [{ label: "Leads", cur: cur.leads, prev: prev?.leads, unit: "número" }] : []),
    { label: "Usuários", cur: cur.users, prev: prev?.users, unit: "número" },
    { label: "Taxa de engajamento", cur: cur.engagementRate, prev: prev?.engagementRate, unit: "fração (0 a 1)" },
    { label: terms.conversion, cur: cur.conversion, prev: prev?.conversion, unit: "fração (0 a 1)" },
    { label: terms.revenue, cur: cur.revenue, prev: prev?.revenue, unit: "R$" },
    { label: terms.ticket, cur: cur.ticket, prev: prev?.ticket, unit: "R$" },
  ];
  return (
    <CardFrame name="Indicadores do período" className="space-y-4 2xl:space-y-5">
      <ExportData
        table={{
          columns: [
            { key: "label", label: "Indicador", format: "text" },
            { key: "cur", label: fmtRange(ctx.current), format: "decimal" },
            ...(ctx.comparison
              ? [
                  { key: "prev", label: fmtRange(ctx.comparison), format: "decimal" as const },
                  { key: "change", label: "Variação", format: "pct" as const },
                ]
              : []),
            { key: "unit", label: "Unidade", format: "text" },
          ],
          rows: kpis.map((k) => ({ ...k, change: k.prev ? (k.cur - k.prev) / k.prev : null })),
        }}
      />
      <MetaNotice meta={meta} />
      {(terms.lead || hasLead) && <LeadCoverageNotice ctx={ctx} />}
      <div className="grid gap-4 sm:grid-cols-2 2xl:gap-5 min-[90rem]:grid-cols-4">
        <KpiCard
          label="Total de eventos"
          value={cur.events}
          prev={prev?.events}
          format="int"
          compareText={vs}
          spark={spark("events")}
          prevSpark={prevSpark("events")}
        />
        <KpiCard
          label="Total de sessões"
          value={cur.sessions}
          prev={prev?.sessions}
          format="int"
          compareText={vs}
          spark={spark("sessions")}
          prevSpark={prevSpark("sessions")}
        />
        <KpiCard
          label="Compras"
          value={cur.purchases}
          prev={prev?.purchases}
          format="int"
          compareText={vs}
          incomparable={changed}
          spark={spark("purchases")}
          prevSpark={prevSpark("purchases")}
        />
        {hasLead ? (
          <KpiCard
            label="Leads"
            value={cur.leads}
            prev={prev?.leads}
            format="int"
            compareText={vs}
            spark={spark("leads")}
            prevSpark={prevSpark("leads")}
          />
        ) : (
          <KpiCard
            label="Usuários"
            value={cur.users}
            prev={prev?.users}
            format="int"
            compareText={vs}
            spark={spark("users")}
            prevSpark={prevSpark("users")}
          />
        )}
      </div>
      <KpiStrip count={4}>
        <KpiTile label="Usuários" value={cur.users} prev={prev?.users} format="int" />
        <KpiTile label="Taxa de engajamento" value={cur.engagementRate} prev={prev?.engagementRate} format="pct" />
        <KpiTile
          label={terms.lead ? terms.conversion : src.derived ? "Conversão" : "Conversão da sessão"}
          value={cur.conversion}
          prev={prev?.conversion}
          format="pct"
          incomparable={terms.lead ? undefined : changed}
          note={terms.lead ? terms.conversionHelp : src.derived ? "Compras ÷ sessões" : "Sessões com compra ÷ sessões"}
        />
        <KpiTile
          label={terms.revenue}
          value={cur.revenue}
          prev={prev?.revenue}
          format="brl"
          incomparable={changed}
          note={`${terms.ticket}: ${fmtBRL(cur.ticket, { compact: true })} · ${fmtInt(cur.transactions)} com ID de transação`}
        />
      </KpiStrip>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-xs text-muted">
          {ctx.comparison && <>Variações contra {compareWith(page.state)} ({fmtRange(ctx.comparison)}).</>}
          {ctx.comparison && changed && " Compras e valores marcados com “medição mudou” não são comparáveis entre os dois períodos."}
        </p>
        <ExportMenu />
      </div>
    </CardFrame>
  );
}

/** Gráfico de evolução. Repete as consultas dos cartões, que a essa altura já estão em cache. */
async function Trend({ page }: { page: PageContext }) {
  const { ctx } = page;
  const res = await settle(
    (async () => {
      const { terms, hasLead } = await baseMetrics(ctx);
      const [cur, prev] = await Promise.all([loadDaily(ctx, ctx.current), ctx.comparison ? loadDaily(ctx, ctx.comparison) : null]);
      return { cur, prev, terms, hasLead };
    })(),
  );
  if (!res.ok) return <ErrorBlock message={res.error} />;
  const { terms, hasLead } = res.data;
  // Ao agrupar por semana ou mês, a conversão vira média ponderada por sessões. Usuários não somam
  // entre dias (a mesma pessoa volta), então só aparecem na visão diária.
  const metrics: SeriesMetric[] = [
    { key: "sessions", label: "Sessões", format: "int" },
    { key: "events", label: "Eventos", format: "int" },
    { key: "purchases", label: "Compras", format: "int" },
    ...(hasLead ? [{ key: "leads", label: "Leads", format: "int" as const }] : []),
    { key: "conversion", label: terms.conversion, format: "pct", weight: "sessions" },
    { key: "revenue", label: terms.revenue, format: "brl" },
    { key: "users", label: "Usuários", format: "int", additive: false },
  ];
  return (
    <Card
      title="Evolução no período"
      subtitle={`${fmtRange(ctx.current)}${ctx.comparison ? ` · tracejado: ${fmtRange(ctx.comparison)}` : ""}. Agrupe por dia, semana ou mês.`}
    >
      <MetaNotice meta={mergeMeta(res.data.cur.meta, res.data.prev?.meta)} />
      <TimeSeriesChart
        points={res.data.cur.points}
        prevPoints={res.data.prev?.points}
        currentLabel={fmtRange(ctx.current)}
        prevLabel={ctx.comparison ? fmtRange(ctx.comparison) : undefined}
        metrics={metrics}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Resumo de cada análise do briefing
// ---------------------------------------------------------------------------

/** Moldura dos resumos: título, link para a análise completa (mantendo período e filtros) e rodapé opcional. */
function PreviewCard({
  title,
  href,
  page,
  headline,
  children,
  footer,
}: {
  title: string;
  href: string;
  page: PageContext;
  headline?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <CardFrame name={title} className="refetch-dim flex min-w-0 flex-col rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <header className="mb-4 flex items-start justify-between gap-3">
        <h2 className="text-[1.0625rem] leading-snug font-semibold text-ink">{title}</h2>
        <div className="no-export flex shrink-0 items-center gap-1.5">
          <Link
            href={`${href}${serializeState(page.state)}`}
            className="inline-flex h-8 items-center gap-1 rounded-full border border-line px-3 text-xs font-medium text-ink-2 hover:border-accent hover:text-accent"
          >
            Ver análise <ArrowRight size={12} aria-hidden />
          </Link>
          <ExportMenu />
        </div>
      </header>
      {headline && <p className="mb-4 text-[0.8125rem] leading-relaxed text-ink-2">{headline}</p>}
      <div>{children}</div>
      {footer && <div className="mt-auto pt-4">{footer}</div>}
    </CardFrame>
  );
}

/** Barras finas em HTML: rótulo, barra e valor (uma linha por item). */
function MiniBars({
  rows,
  tone = "accent",
  csv,
}: {
  rows: { label: string; value: number; text: string; sub?: string; ref?: number; extra?: number | null }[];
  tone?: "accent" | "highlight";
  /** Colunas do CSV do cartão: o valor da barra, a referência (traço) e um número extra de cada linha. */
  csv: { label: string; value: string; format: FormatKind; ref?: string; extra?: { label: string; format: FormatKind } };
}) {
  // A escala inclui as referências para o traço não passar do fim da barra. Valor acima de zero
  // ganha ao menos 1,5% de largura para não sumir.
  const max = Math.max(...rows.map((r) => r.value), ...rows.map((r) => r.ref ?? 0), 1e-9);
  return (
    <ul className="space-y-2.5">
      <ExportData
        table={{
          columns: [
            { key: "label", label: csv.label, format: "text" },
            { key: "value", label: csv.value, format: csv.format },
            ...(csv.ref ? [{ key: "ref", label: csv.ref, format: csv.format }] : []),
            ...(csv.extra ? [{ key: "extra", label: csv.extra.label, format: csv.extra.format }] : []),
          ],
          rows: rows.map((r) => ({ label: r.label, value: r.value, ref: r.ref, extra: r.extra })),
        }}
      />
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-3 text-[0.8125rem]">
            <span className="min-w-0 truncate text-ink" title={r.label}>
              {r.label}
            </span>
            <span className="shrink-0 tabular">
              <strong className="font-semibold text-ink">{r.text}</strong>
              {r.sub && <span className="ml-1.5 text-xs text-muted">{r.sub}</span>}
            </span>
          </div>
          <div className="relative mt-1 h-1.5 rounded-full bg-raised" aria-hidden>
            <div
              className={tone === "accent" ? "h-full rounded-full bg-accent" : "h-full rounded-full bg-highlight"}
              style={{ width: `${Math.max((r.value / max) * 100, r.value > 0 ? 1.5 : 0)}%` }}
            />
            {r.ref !== undefined && (
              <span className="absolute -top-0.5 h-2.5 w-0.5 rounded-full bg-ink-2" style={{ left: `${(r.ref / max) * 100}%` }} />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Resumo do funil: a jornada do simulador quando existe, senão o funil padrão por eventos. */
async function FunnelPreview({ page }: { page: PageContext }) {
  const res = await settle(
    (async () => {
      const journey = await journeySteps(page.ctx).catch(() => null);
      const steps = journey ?? (await defaultFunnel(page.ctx)).steps;
      return { f: await runFunnel(page.ctx, steps), journey: !!journey };
    })(),
  );
  if (!res.ok) return <ErrorBlock message={res.error} />;
  const steps = res.data.f.total.steps;
  const first = steps[0]?.users ?? 0;
  const last = steps.at(-1)?.users ?? 0;
  // A maior perda só considera etapas com 30 usuários ou mais; abaixo disso a taxa oscila demais.
  const drops = steps.slice(0, -1).map((s, i) => ({ i, drop: s.users >= 30 ? (s.dropRate ?? 0) : 0 }));
  const worst = drops.sort((a, b) => b.drop - a.drop)[0];
  return (
    <PreviewCard
      title="Funil de conversão"
      href="/funil"
      page={page}
      headline={
        first ? (
          <>
            <strong className="font-semibold text-ink">{fmtCompact(first)}</strong> iniciaram{res.data.journey ? " a simulação" : ""} e{" "}
            <strong className="font-semibold text-ink">{fmtPct(last / first, 1)}</strong> chegaram ao fim.
            {worst && worst.drop > 0 && (
              <>
                {" "}
                Maior perda: {steps[worst.i].label} → {steps[worst.i + 1].label} ({fmtPct(worst.drop, 0)} saem).
              </>
            )}
          </>
        ) : (
          "Sem usuários no funil neste recorte."
        )
      }
    >
      <MiniBars
        csv={{ label: "Etapa", value: "Usuários", format: "int", extra: { label: "% do início", format: "pct" } }}
        rows={steps.map((s, i) => ({
          label: `${i + 1}. ${s.label}`,
          value: s.users,
          text: fmtCompact(s.users),
          sub: i ? fmtPct(s.fromStart, 0) : undefined,
          extra: s.fromStart,
        }))}
      />
    </PreviewCard>
  );
}

/** Resumo do perfil por faixa etária. O traço de cada barra marca a fatia daquela faixa no público. */
async function ProfilePreview({ page }: { page: PageContext }) {
  const res = await settle(profileReport(page.ctx, "userAgeBracket"));
  if (!res.ok) return <ErrorBlock message={res.error} />;
  const r = res.data;
  const metric = r.hasLead ? "leads" : "compras";
  const share = (x: (typeof r.rows)[number]) => (r.hasLead ? x.shareLeads : x.sharePurchases);
  // Volume e conversão juntos: só "18-24 converte mais" parecia contradizer os 36% de leads de 25-34.
  const h = profileHighlights(r);
  const strong = (label: string) => <strong className="font-semibold text-ink">{label}</strong>;
  return (
    <PreviewCard
      title="Perfil do usuário"
      href="/perfil"
      page={page}
      headline={
        !h ? (
          "Sem dados de idade suficientes no período."
        ) : h.top.key === h.best.key ? (
          <>
            {strong(h.top.label)} traz mais {h.metric} ({fmtPct(h.share(h.top), 0)}) e é a faixa que mais converte (
            {h.index(h.top).toFixed(1).replace(".", ",")}x a média). O traço marca a fatia do público.
          </>
        ) : (
          <>
            {strong(h.top.label)} traz mais {h.metric} ({fmtPct(h.share(h.top), 0)}). {strong(h.best.label)} converte mais:{" "}
            {fmtPct(h.share(h.best), 0)} dos {h.metric} com {fmtPct(h.best.shareUsers, 0)} do público. O traço marca a fatia do público.
          </>
        )
      }
    >
      <MiniBars
        csv={{ label: "Faixa etária", value: `% dos ${metric}`, format: "pct", ref: "% do público" }}
        rows={r.rows.map((x) => ({ label: x.label, value: share(x), ref: x.shareUsers, text: fmtPct(share(x), 0), sub: `dos ${metric}` }))}
      />
    </PreviewCard>
  );
}

/** Meta compra com a maioria das compras sem origem: conversão por campanha e categoria fica perto de zero. */
async function BlindHint({ page }: { page: PageContext }) {
  const [a, hasLead] = await Promise.all([
    purchaseAttribution(page.ctx).catch(() => null),
    leadAvailable(page.ctx.propertyId).catch(() => false),
  ]);
  // Meta lead pedida numa propriedade sem lead vira compra, então o aviso continua valendo lá.
  if (page.state.goal === "lead" && hasLead) return null;
  // Com menos de 20 compras a fatia sem origem ainda não diz nada.
  if (!a || a.total < 20 || a.share < ATTRIBUTION_ALERT) return null;
  return (
    <div className="rounded-xl bg-warning/10 px-3 py-2.5 text-xs leading-relaxed text-ink-2">
      {fmtPct(a.share, 0)} das compras chegam sem origem, então a conversão em compra fica perto de zero aqui.
      {hasLead && (
        <>
          {" "}
          <GoalButton goal="lead">Ver por lead</GoalButton>
        </>
      )}
    </div>
  );
}

/**
 * Resumo das campanhas: as 6 com mais sessões e a que mais converte entre as grandes.
 * A análise completa fica na página de Páginas e campanhas.
 */
async function CampaignPreview({ page }: { page: PageContext }) {
  const res = await settle(croByDimension(page.ctx, "sessionCampaignName", { limit: 8 }));
  if (!res.ok) return <ErrorBlock message={res.error} />;
  const { terms } = res.data;
  const total = res.data.total.cur;
  const rows = res.data.rows.filter((x) => x.cur.sessions > 0).slice(0, 6);
  // "Grandes" = 2% das sessões ou mais, para uma campanha minúscula com uma conversão não virar destaque.
  const best = [...rows].filter((x) => x.cur.sessions >= total.sessions * 0.02).sort((a, b) => b.cur.conversion - a.cur.conversion)[0];
  const label = (v: string) => (v === "(not set)" ? "(sem campanha)" : v);
  return (
    <PreviewCard
      title="Campanhas"
      href="/paginas"
      page={page}
      footer={<BlindHint page={page} />}
      headline={
        best ? (
          <>
            Maior {terms.conversion.toLowerCase()} entre as grandes: <strong className="font-semibold text-ink">{label(best.value)}</strong> (
            {fmtPct(best.cur.conversion)}, média {fmtPct(total.conversion)}).
          </>
        ) : undefined
      }
    >
      <MiniBars
        csv={{ label: "Campanha", value: "Sessões", format: "int", extra: { label: terms.conversion, format: "pct" } }}
        rows={rows.map((x) => ({
          label: label(x.value),
          value: x.cur.sessions,
          text: fmtCompact(x.cur.sessions),
          sub: `${fmtPct(x.cur.conversion, 1)} ${terms.lead ? "lead" : "conv."}`,
          extra: x.cur.conversion,
        }))}
      />
    </PreviewCard>
  );
}

/** Resumo das categorias: conversão de cada uma, com o traço na média do site. */
async function CategoryPreview({ page }: { page: PageContext }) {
  const res = await settle(categoryReport(page.ctx));
  if (!res.ok) return <ErrorBlock message={res.error} />;
  const r = res.data;
  // A última da lista é "Sem categoria", que não é produto e fica fora do resumo.
  const cats = r.byCategory.filter((c) => c.sessions > 0 && c.key !== CATEGORIES[CATEGORIES.length - 1]);
  const best = [...cats].sort((a, b) => aggRate(b) - aggRate(a))[0];
  return (
    <PreviewCard
      title="Categorias de produto"
      href="/categorias"
      page={page}
      footer={<BlindHint page={page} />}
      headline={
        best ? (
          <>
            <strong className="font-semibold text-ink">{best.key}</strong> tem a maior {r.terms.conversion.toLowerCase()} ({fmtPct(aggRate(best))}).
            O traço marca a média do site ({fmtPct(r.total.conversion)}).
          </>
        ) : undefined
      }
    >
      <MiniBars
        csv={{ label: "Categoria", value: r.terms.conversion, format: "pct", ref: "Média do site", extra: { label: "Sessões", format: "int" } }}
        rows={cats.map((c) => ({
          label: c.key,
          value: aggRate(c),
          ref: r.total.conversion,
          text: fmtPct(aggRate(c)),
          sub: `${fmtCompact(c.sessions)} sessões`,
          extra: c.sessions,
        }))}
      />
    </PreviewCard>
  );
}

// ---------------------------------------------------------------------------
// Alertas e plataformas
// ---------------------------------------------------------------------------

const TONE_ICON: Record<Tone, { icon: typeof Info; cls: string; label: string }> = {
  critical: { icon: OctagonExclamationPoint, cls: "text-critical-ink", label: "Crítico" },
  warning: { icon: CircleExclamationPoint, cls: "text-warning-ink", label: "Atenção" },
  good: { icon: CircleCheck, cls: "text-good-ink", label: "Positivo" },
  info: { icon: Info, cls: "text-accent", label: "Informação" },
};

/** Alertas gerados por regras sobre o período (lib/insights), cada um com link para a análise que o explica. */
async function Insights({ page }: { page: PageContext }) {
  const res = await settle(
    (async () => buildInsights(page.ctx, getTerms(await effectiveGoal(page.ctx)), compareLabel(page.state)))(),
  );
  if (!res.ok) return <ErrorBlock message={res.error} />;
  const query = serializeState(page.state);
  const count = (tone: Tone) => res.data.filter((i) => i.tone === tone).length;
  const summary = [
    count("critical") > 0 && `${count("critical")} ${count("critical") > 1 ? "críticos" : "crítico"}`,
    count("warning") > 0 && `${count("warning")} de atenção`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Card
      title="Alertas e insights"
      subtitle={`Regras sobre os dados do período, com volume mínimo para evitar ruído${summary ? ` · ${summary}` : ""}.`}
    >
      <ExportData
        table={{
          columns: [
            { key: "tone", label: "Tipo", format: "text" },
            { key: "title", label: "Alerta", format: "text" },
            { key: "text", label: "Detalhe", format: "text" },
          ],
          rows: res.data.map((i) => ({ tone: TONE_ICON[i.tone].label, title: i.title, text: i.text })),
        }}
      />
      {res.data.length === 0 ? (
        <p className="text-sm text-ink-2">Nenhum alerta relevante no período.</p>
      ) : (
        <div className="overflow-hidden">
          <ul className="-mt-px grid gap-x-10 lg:grid-cols-2 min-[112.5rem]:grid-cols-3">
            {res.data.map((i) => {
              const { icon: Icon, cls, label } = TONE_ICON[i.tone];
              // O link do alerta pode ter parâmetros próprios: junta com o estado atual sem perder nenhum.
              const [path, extra] = (i.href ?? "").split("?");
              const href = i.href ? `${path}${query}${extra ? `${query ? "&" : "?"}${extra}` : ""}` : undefined;
              return (
                <li key={i.title} className="flex gap-3 border-t border-rule py-4">
                  <Icon size={18} aria-label={label} className={`mt-px shrink-0 ${cls}`} />
                  <div className="min-w-0">
                    <p className="text-sm leading-snug font-semibold text-ink">{i.title}</p>
                    <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-2">{i.text}</p>
                    {href && (
                      <Link
                        href={href}
                        className="no-export mt-2 inline-flex items-center gap-1 text-[0.8125rem] font-medium text-accent hover:underline"
                      >
                        Ver detalhes <ArrowRight size={13} aria-hidden />
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}

/** Só aparece quando a propriedade tem mais de uma plataforma (ex.: web e app juntos). */
async function Platforms({ page }: { page: PageContext }) {
  const res = await settle(croByDimension(page.ctx, "platform"));
  if (!res.ok || res.data.rows.filter((r) => r.cur.sessions > 0).length < 2) return null;
  return (
    <Card title="Por plataforma" subtitle="Clique numa plataforma para filtrar todo o painel.">
      <DataTable
        filename="cro-plataforma"
        columns={croColumns(res.data.terms, { key: "platform", label: "Plataforma", filterKey: "plataforma" })}
        rows={res.data.rows.map((r) => croRow(r.value, "platform", r.value, r.cur, r.prev))}
        initialSort={{ key: "sessions" }}
        searchable={false}
      />
    </Card>
  );
}

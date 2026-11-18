import { Suspense } from "react";

import { OpportunityMatrix, ShareBars } from "@/components/charts/Charts";
import { DashboardShell } from "@/components/shell/DashboardShell";
import { DataTable, type TableRow } from "@/components/table/DataTable";
import { GroupedTable, type GroupMetric, type GroupNode } from "@/components/table/GroupedTable";
import { AttributionNotice } from "@/components/ui/AttributionNotice";
import { MetaNotice } from "@/components/ui/MetaNotice";
import { GoalButton } from "@/components/ui/GoalButton";
import { Card, ErrorBlock, Notice, PageHeader, Skeleton } from "@/components/ui/primitives";
import { SectionTabs } from "@/components/ui/SectionTabs";
import { ERROR_EVENTS } from "@/config/cro";
import { fmtInt, fmtPct } from "@/lib/format";
import { buildContext, type PageContext } from "@/lib/ga4/context";
import { cro, croByDimension, croMetrics, leadAvailable, usersByEvent, type Cro, type Terms } from "@/lib/ga4/kpis";
import { mergeMeta, runReport, settle } from "@/lib/ga4/report";
import { ATTRIBUTION_ALERT, purchaseAttribution } from "@/lib/quality";
import type { FilterKey, SearchParams } from "@/lib/state";
import { inventory90 } from "@/lib/views";

/** Valor que é caminho de página (descarta "(not set)" e vazio). */
const isPath = (v: string | undefined) => Boolean(v && v.startsWith("/"));

/** Mediana simples: o valor do meio, sem tirar média dos dois centrais. */
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

type GroupDef = { id: string; dim: string; label: string; plural: string; filterKey?: FilterKey };

/** Agrupamentos da comparação: campanha, origem/mídia e página de entrada, cada um abrindo os outros. */
const GROUPS: GroupDef[] = [
  { id: "campanha", dim: "sessionCampaignName", label: "Campanha", plural: "campanhas", filterKey: "campanha" },
  { id: "origem", dim: "sessionSourceMedium", label: "Origem / mídia", plural: "origens", filterKey: "origem" },
  { id: "pagina", dim: "landingPage", label: "Página de entrada", plural: "páginas" },
];

/**
 * Páginas e campanhas: comparativo por campanha, origem/mídia ou página de entrada (?agrupar e
 * ?detalhar), matriz de oportunidade e listas de páginas. Em propriedade só de app, mostra as telas.
 */
export default async function PagesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const page = buildContext(sp);
  const group = GROUPS.find((g) => g.id === sp.agrupar) ?? GROUPS[0];
  const others = GROUPS.filter((g) => g.id !== group.id);
  const detail = others.find((g) => g.id === sp.detalhar) ?? others[0];
  return (
    <DashboardShell page={page} section="paginas">
      <Suspense fallback={<Skeleton className="h-[640px]" />}>
        <Content page={page} group={group} detail={detail} />
      </Suspense>
    </DashboardShell>
  );
}

/** Site: páginas de entrada. App (sem landing page no GA4): telas, com foco em erros. */
async function Content({ page, group, detail }: { page: PageContext; group: GroupDef; detail: GroupDef }) {
  const probe = await settle(
    runReport(page.ctx, {
      dimensions: ["landingPage"],
      metrics: ["sessions"],
      compare: false,
      orderBy: { metric: "sessions" },
      limit: 5,
    }),
  );
  // Página de entrada de site sempre começa com "/". Em app vem "(not set)" ou vazio.
  const hasWeb = probe.ok && probe.data.rows.some((r) => isPath(r.dims.landingPage) && r.cur.sessions > 0);
  return hasWeb ? <LandingPages page={page} group={group} detail={detail} /> : <Screens page={page} />;
}

/** Valores de uma linha do comparativo; a receita só entra quando a meta é compra. */
const nodeValues = (c: Cro, terms: Terms): Record<string, number> => ({
  sessions: c.sessions,
  engagementRate: c.engagementRate,
  conversion: c.conversion,
  goals: c.goals,
  ...(terms.lead ? {} : { revenue: c.revenue }),
});

/** "(not set)" e vazio aparecem como "(sem valor)". */
const cleanLabel = (v: string) => (v === "(not set)" || v === "" ? "(sem valor)" : v);

/** Comparativo em dois níveis: cada grupo abre os valores da outra dimensão que trouxeram as sessões. */
async function GroupedBlock({ page, group, detail }: { page: PageContext; group: GroupDef; detail: GroupDef }) {
  // Na dimensão página de entrada, fica só o que é caminho de verdade.
  const keep = (g: GroupDef, v: string | undefined) => g.dim !== "landingPage" || isPath(v);
  // Os pares grupo x detalhe vêm numa consulta só, em vez de uma por grupo.
  const [top, pairs] = await Promise.all([
    settle(croByDimension(page.ctx, group.dim, { limit: 250 })),
    settle(
      (async () => {
        const { metrics, src } = await croMetrics(page.ctx);
        const r = await runReport(page.ctx, {
          dimensions: [group.dim, detail.dim],
          metrics,
          orderBy: { metric: "sessions" },
          limit: 8000,
        });
        return { r, src };
      })(),
    ),
  ]);
  const tabs = (
    <>
      <SectionTabs param="agrupar" label="Agrupar por" options={GROUPS} current={group.id} />
      <SectionTabs
        param="detalhar"
        label="Abrir cada grupo por"
        options={GROUPS.filter((g) => g.id !== group.id).map((g) => ({ id: g.id, label: `› ${g.label}` }))}
        current={detail.id}
      />
    </>
  );
  if (!top.ok) {
    return (
      <Card title="Comparativo por grupo" actions={tabs}>
        <ErrorBlock message={top.error} />
      </Card>
    );
  }
  const { terms } = top.data;
  const total = top.data.total.cur;
  const children = new Map<string, GroupNode[]>();
  if (pairs.ok) {
    for (const row of pairs.data.r.rows) {
      const gv = row.dims[group.dim];
      const dv = row.dims[detail.dim];
      if (!keep(detail, dv)) continue;
      const c = cro(row.cur, pairs.data.src);
      const p = row.prev ? cro(row.prev, pairs.data.src) : undefined;
      const list = children.get(gv) ?? [];
      list.push({ id: dv, label: cleanLabel(dv), values: nodeValues(c, terms), prev: p ? nodeValues(p, terms) : undefined });
      children.set(gv, list);
    }
  }
  // Cada grupo abre até 8 filhos; o resto vira só a contagem do que ficou de fora.
  const SHOW = 8;
  const groups: GroupNode[] = top.data.rows
    .filter((r) => keep(group, r.value) && r.cur.sessions > 0)
    .map((r) => {
      const kids = (children.get(r.value) ?? []).sort((a, b) => b.values.sessions - a.values.sessions);
      return {
        id: r.value,
        label: cleanLabel(r.value),
        values: nodeValues(r.cur, terms),
        prev: r.prev ? nodeValues(r.prev, terms) : undefined,
        children: kids.slice(0, SHOW),
        more: Math.max(0, kids.length - SHOW),
      };
    });
  const metrics: GroupMetric[] = [
    { key: "sessions", label: "Sessões", format: "int", bar: true, delta: true },
    { key: "engagementRate", label: "Engajamento", format: "pct" },
    { key: "conversion", label: terms.conversion, format: "pct", delta: true, help: terms.conversionHelp },
    { key: "goals", label: terms.goal, format: "int", delta: true },
    ...(terms.lead ? [] : ([{ key: "revenue", label: terms.revenue, format: "brl" }] as GroupMetric[])),
  ];
  const top8 = groups.slice(0, 8);
  const opens = detail.plural === "páginas" ? "as páginas de entrada" : `as ${detail.plural}`;
  return (
    <Card
      title={`Comparativo por ${group.label.toLowerCase()}`}
      subtitle={`Cada linha abre ${opens} que trouxeram as sessões.${
        group.filterKey ? " O ícone de filtro na linha aplica o grupo ao painel inteiro, inclusive ao funil." : ""
      }`}
      actions={tabs}
    >
      {top8.length > 1 && total.sessions > 0 && (
        <div className="mb-6 border-b border-rule pb-6">
          <p className="mb-2 text-sm font-semibold text-ink">
            Participação nas sessões x {terms.lead ? "nos leads" : "nas compras"}: as {top8.length} maiores
          </p>
          <ShareBars
            categories={top8.map((g) => g.label)}
            a={{ label: "% das sessões", values: top8.map((g) => g.values.sessions / total.sessions) }}
            b={{
              label: terms.lead ? "% dos leads" : "% das compras",
              values: top8.map((g) => (total.goals ? g.values.goals / total.goals : 0)),
            }}
            filterKey={group.filterKey}
          />
        </div>
      )}
      <GroupedTable
        key={`${group.id}>${detail.id}`}
        groupLabel={group.label}
        groupPlural={group.plural}
        detailLabel={detail.label}
        metrics={metrics}
        groups={groups}
        filterKey={group.filterKey}
      />
    </Card>
  );
}

/** Versão de site: comparativo, matriz de oportunidade e listas de páginas de entrada. */
async function LandingPages({ page, group, detail }: { page: PageContext; group: GroupDef; detail: GroupDef }) {
  // Página sem query string: utm, gclid e parâmetros do app partiriam a mesma página em centenas de linhas.
  const [res, attribution, lead] = await Promise.all([
    settle(croByDimension(page.ctx, "landingPage", { limit: 300, extraMetrics: ["bounceRate"] })),
    settle(purchaseAttribution(page.ctx)),
    leadAvailable(page.ctx.propertyId).catch(() => false),
  ]);
  return (
    <>
      <PageHeader
        title="Páginas e campanhas"
        description="Campanhas, origens e páginas de entrada lado a lado: de onde vem o tráfego, onde ele começa e quanto converte. A matriz destaca páginas com muito tráfego e conversão baixa."
      />
      {!res.ok ? (
        <ErrorBlock message={res.error} />
      ) : (
        (() => {
          const { terms } = res.data;
          const total = res.data.total.cur;
          const rows = res.data.rows.filter((r) => isPath(r.value));
          // "Muito tráfego" = mediana de sessões por página, com piso de 100. A perda de cada página é
          // quantas metas ela ganharia convertendo na média; as 15 maiores ganham destaque na matriz.
          const threshold = Math.max(100, median(rows.map((r) => r.cur.sessions)));
          const attention = rows
            .filter((r) => r.cur.sessions >= threshold && r.cur.conversion < total.conversion)
            .map((r) => ({ r, lost: r.cur.sessions * (total.conversion - r.cur.conversion) }))
            .sort((a, b) => b.lost - a.lost);
          const flagged = new Set(attention.slice(0, 15).map((a) => a.r.value));
          const toRow = (r: (typeof rows)[number], lost?: number): TableRow => ({
            id: r.value,
            values: {
              page: r.value,
              sessions: r.cur.sessions,
              engagementRate: r.cur.engagementRate,
              bounceRate: r.row.cur.bounceRate ?? 0,
              conversion: r.cur.conversion,
              goals: r.cur.goals,
              revenue: r.cur.revenue,
              ...(lost !== undefined ? { lost } : {}),
            },
            prev: r.prev ? { sessions: r.prev.sessions, conversion: r.prev.conversion } : undefined,
          });
          const cols = [
            { key: "page", label: "Página de entrada", type: "dim" as const },
            { key: "sessions", label: "Sessões", type: "metric" as const, format: "int" as const, bar: true, delta: true },
            { key: "engagementRate", label: "Engajamento", type: "metric" as const, format: "pct" as const },
            { key: "bounceRate", label: "Rejeição", type: "metric" as const, format: "pct" as const },
            {
              key: "conversion",
              label: terms.conversion,
              type: "metric" as const,
              format: "pct" as const,
              delta: true,
              help: terms.conversionHelp,
            },
            { key: "goals", label: terms.goal, type: "metric" as const, format: "int" as const },
            ...(terms.lead ? [] : [{ key: "revenue", label: terms.revenue, type: "metric" as const, format: "brl" as const }]),
          ];
          const missing = terms.lead ? "pelos leads que faltam" : "pelas compras que faltam";
          // Compra sem página de entrada (enviada pelo servidor sem a sessão): todas as páginas ficam perto de
          // zero e a matriz não separa nada. Nesse caso ela dá lugar à explicação e ao atalho para a meta lead.
          const blind =
            !terms.lead && attribution.ok && attribution.data.total >= 20 && attribution.data.share >= ATTRIBUTION_ALERT;
          // Páginas com menos sessões que isso ficam fora do gráfico (taxa de amostra pequena engana).
          const minX = Math.min(threshold, Math.max(50, Math.round(threshold / 4)));
          const lostBy = new Map(attention.map((a) => [a.r.value, a.lost]));
          return (
            <div className="space-y-5">
              <MetaNotice meta={res.data.report.meta} />
              <AttributionNotice ctx={page.ctx} what="página de entrada" />
              <Suspense fallback={<Skeleton className="h-[520px]" />}>
                <GroupedBlock page={page} group={group} detail={detail} />
              </Suspense>
              <Card
                title="Matriz de oportunidade"
                subtitle={
                  blind
                    ? "Onde estão as páginas com muito tráfego e conversão abaixo da média."
                    : `Cada ponto é uma página de entrada: mais à direita, mais sessões; mais alto, mais ${terms.lead ? "leads" : "compras"} por sessão. A área vermelha junta as páginas com mais de ${fmtInt(threshold)} sessões e ${terms.conversion.toLowerCase()} abaixo da média: é onde um teste de CRO rende mais.`
                }
              >
                {blind && attribution.ok ? (
                  <div className="max-w-3xl py-2">
                    <p className="text-sm font-semibold text-ink">Com a meta Compra, esta matriz não funciona hoje</p>
                    <p className="mt-1 text-sm leading-relaxed text-ink-2">
                      {fmtPct(attribution.data.share, 0)} das compras chegam sem página de entrada (veja o aviso acima). Para o GA4 elas
                      não começaram em página nenhuma, então todas as páginas aparecem com conversão perto de zero e o gráfico não
                      separa as que vendem das que não vendem.
                      {lead
                        ? " O lead é registrado no navegador, com a página de entrada, e mostra a matriz de verdade."
                        : " Ela volta a funcionar quando a compra for enviada com o client_id e o session_id do navegador."}
                    </p>
                    {lead && (
                      <GoalButton goal="lead" variant="button">
                        Ver a matriz por lead
                      </GoalButton>
                    )}
                  </div>
                ) : (
                  <OpportunityMatrix
                    points={rows.map((r) => ({
                      name: r.value,
                      x: r.cur.sessions,
                      y: r.cur.conversion,
                      flagged: flagged.has(r.value),
                      weight: lostBy.get(r.value),
                    }))}
                    xLabel="Sessões"
                    yLabel={terms.conversion}
                    xFormat="int"
                    yFormat="pct"
                    xRef={threshold}
                    yRef={total.conversion}
                    minX={minX}
                    weightLabel={`${terms.goal} que faltam para a média`}
                    weightUnit={terms.goal.toLowerCase()}
                    zoneLabel={`Muito tráfego, ${terms.conversion.toLowerCase()} abaixo da média`}
                    itemLabel="página"
                    flaggedLabel="Maiores oportunidades"
                    otherLabel="Demais páginas"
                    rankTitle="Onde testar primeiro"
                    rankNote={`O número é a posição no gráfico. À direita, quantos ${terms.goal.toLowerCase()} a página ganharia convertendo na média.`}
                  />
                )}
              </Card>
              <Card
                title="Páginas que mais precisam de atenção"
                subtitle={`Tráfego acima de ${fmtInt(threshold)} sessões e ${terms.conversion.toLowerCase()} abaixo da média, ordenadas ${missing} para chegar à média.${
                  blind ? " Com as compras sem página de entrada, esta ordem acompanha quase só o volume de sessões." : ""
                }`}
              >
                <DataTable
                  filename="paginas-atencao"
                  columns={[...cols, { key: "lost", label: `${terms.goal} abaixo da média`, type: "metric", format: "decimal", bar: true }]}
                  rows={attention.map((a) => toRow(a.r, a.lost))}
                  initialSort={{ key: "lost" }}
                />
              </Card>
              <Card title="Todas as páginas de entrada">
                <DataTable filename="paginas-entrada" columns={cols} rows={rows.map((r) => toRow(r))} initialSort={{ key: "sessions" }} />
              </Card>
            </div>
          );
        })()
      )}
    </>
  );
}

/** Versão de app: telas por volume e tempo, com taxa de erro por tela quando há eventos de erro. */
async function Screens({ page }: { page: PageContext }) {
  const { ctx } = page;
  const inv = await inventory90(ctx).catch(() => []);
  const errorEvents = ERROR_EVENTS.filter((e) => inv.some((i) => i.event === e));
  const [base, errs] = await Promise.all([
    settle(
      runReport(ctx, {
        dimensions: ["unifiedScreenName"],
        metrics: ["screenPageViews", "activeUsers", "userEngagementDuration"],
        orderBy: { metric: "screenPageViews" },
        limit: 300,
        totals: true,
      }),
    ),
    errorEvents.length ? settle(usersByEvent(ctx, "unifiedScreenName", errorEvents, 5000)) : null,
  ]);

  return (
    <>
      <PageHeader
        title="Telas do app"
        description="Esta propriedade não tem páginas de entrada (dados só de app), então a seção mostra as telas: volume, tempo de engajamento e onde os erros acontecem."
      />
      {!base.ok ? (
        <ErrorBlock message={base.error} />
      ) : (
        (() => {
          const errMap = errs?.ok ? errs.data.map : new Map<string, Record<string, number>>();
          // Usuários com erro = o maior entre os eventos de erro, para não contar duas vezes quem
          // disparou mais de um.
          const errUsers = (screen: string) => Math.max(0, ...errorEvents.map((e) => errMap.get(screen)?.[e] ?? 0));
          const totalUsers = base.data.totals.cur.activeUsers ?? 0;
          const totalErr = Math.max(0, ...errorEvents.map((e) => [...errMap.values()].reduce((n, v) => n + (v[e] ?? 0), 0)));
          const rows = base.data.rows.map((r) => {
            const users = r.cur.activeUsers ?? 0;
            const eu = errUsers(r.dims.unifiedScreenName);
            return {
              name: r.dims.unifiedScreenName,
              views: r.cur.screenPageViews ?? 0,
              users,
              time: users ? (r.cur.userEngagementDuration ?? 0) / users : 0,
              errUsers: eu,
              errRate: users ? eu / users : 0,
              prev: r.prev,
            };
          });
          // Alerta só em tela movimentada (200 usuários ou a mediana, o que for maior) com erro de
          // pelo menos o dobro da média e 2%.
          const minUsers = Math.max(200, median(rows.map((r) => r.users)));
          const avgErr = rows.length ? rows.reduce((n, r) => n + r.errUsers, 0) / Math.max(1, rows.reduce((n, r) => n + r.users, 0)) : 0;
          const isFlagged = (r: (typeof rows)[number]) => errorEvents.length > 0 && r.users >= minUsers && r.errRate >= Math.max(avgErr * 2, 0.02);
          const toRow = (r: (typeof rows)[number]): TableRow => ({
            id: r.name,
            values: { name: r.name, views: r.views, users: r.users, time: r.time, errUsers: r.errUsers, errRate: r.errRate },
            prev: r.prev ? { views: r.prev.screenPageViews, users: r.prev.activeUsers } : undefined,
            flags: isFlagged(r) ? [{ label: "Erro acima da média", tone: "critical" }] : [],
          });
          const cols = [
            { key: "name", label: "Tela", type: "dim" as const },
            { key: "views", label: "Visualizações", type: "metric" as const, format: "int" as const, bar: true, delta: true },
            { key: "users", label: "Usuários", type: "metric" as const, format: "int" as const, delta: true },
            { key: "time", label: "Tempo por usuário", type: "metric" as const, format: "duration" as const },
            ...(errorEvents.length
              ? [
                  { key: "errUsers", label: "Usuários com erro", type: "metric" as const, format: "int" as const },
                  { key: "errRate", label: "% com erro", type: "metric" as const, format: "pct" as const },
                ]
              : []),
          ];
          const flaggedRows = rows.filter(isFlagged).sort((a, b) => b.errUsers - a.errUsers);
          return (
            <div className="space-y-5">
              <MetaNotice meta={mergeMeta(base.data.meta, errs?.ok ? errs.data.meta : undefined)} />
              {errorEvents.length > 0 ? (
                <>
                  <Card
                    title="Matriz de erros por tela"
                    subtitle={`${fmtInt(totalErr)} usuários com ${errorEvents.join(" / ")} (${fmtPct(totalUsers ? totalErr / totalUsers : 0)} dos usuários). Em vermelho: telas movimentadas com taxa de erro bem acima da média.`}
                  >
                    <OpportunityMatrix
                      points={rows.filter((r) => r.users > 0).map((r) => ({ name: r.name, x: r.users, y: r.errRate, flagged: isFlagged(r) }))}
                      xLabel="Usuários na tela"
                      yLabel="% com erro"
                      xFormat="int"
                      yFormat="pct"
                      yRef={avgErr}
                      flaggedLabel="Erro acima da média"
                    />
                  </Card>
                  <Card title="Telas que mais precisam de atenção" subtitle="Ordenadas pelo número de usuários que viram erro na tela.">
                    {flaggedRows.length ? (
                      <DataTable filename="telas-atencao" columns={cols} rows={flaggedRows.map(toRow)} initialSort={{ key: "errUsers" }} />
                    ) : (
                      <p className="text-sm text-ink-2">Nenhuma tela com taxa de erro fora do padrão no período.</p>
                    )}
                  </Card>
                </>
              ) : (
                <Notice>Nenhum evento de erro ({ERROR_EVENTS.join(", ")}) encontrado. Configure CRO_ERROR_EVENTS no .env.</Notice>
              )}
              <Card title="Todas as telas">
                <DataTable filename="telas" columns={cols} rows={rows.map(toRow)} initialSort={{ key: "views" }} />
              </Card>
            </div>
          );
        })()
      )}
    </>
  );
}

import { Suspense } from "react";

import { DashboardShell } from "@/components/shell/DashboardShell";
import { DataTable, type TableRow } from "@/components/table/DataTable";
import { AttributionNotice } from "@/components/ui/AttributionNotice";
import { MetaNotice } from "@/components/ui/MetaNotice";
import { Card, CardHeader, ErrorBlock, KpiStrip, KpiTile, Notice, PageHeader, Skeleton } from "@/components/ui/primitives";
import { fmtInt, fmtPct } from "@/lib/format";
import { buildContext, type PageContext } from "@/lib/ga4/context";
import { runFunnel } from "@/lib/ga4/funnel";
import { croByDimension } from "@/lib/ga4/kpis";
import { settle } from "@/lib/ga4/report";
import type { SearchParams } from "@/lib/state";
import { defaultFunnel } from "@/lib/views";

/** Rótulos dos valores de newVsReturning. Vazio e "(not set)" também aparecem, sobretudo em app. */
const LABELS: Record<string, string> = { new: "Novos", returning: "Recorrentes", "(not set)": "Não identificado", "": "Vazio" };

/**
 * Novos x recorrentes: indicadores lado a lado pela dimensão newVsReturning do GA4 e o funil
 * padrão da propriedade quebrado pelo mesmo recorte.
 */
export default async function NewReturningPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = buildContext(await searchParams);
  return (
    <DashboardShell page={page} section="novos-recorrentes">
      <PageHeader
        title="Novos x recorrentes"
        description="Como usuários na primeira visita e usuários que voltam se comparam em conversão, ticket e engajamento."
      />
      <div className="space-y-5">
        <Suspense fallback={<Skeleton className="h-80" />}>
          <Comparison page={page} />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-56" />}>
          <FunnelByType page={page} />
        </Suspense>
      </div>
    </DashboardShell>
  );
}

/** Os dois grupos lado a lado e a tabela com todos os valores, inclusive os sem classificação. */
async function Comparison({ page }: { page: PageContext }) {
  const res = await settle(croByDimension(page.ctx, "newVsReturning", { extraMetrics: ["userEngagementDuration"] }));
  if (!res.ok) return <ErrorBlock message={res.error} />;
  const { terms } = res.data;
  const find = (v: string) => res.data.rows.find((r) => r.value === v);
  const groups = [find("new"), find("returning")].filter(Boolean) as NonNullable<ReturnType<typeof find>>[];
  const unknown = res.data.rows.filter((r) => r.value !== "new" && r.value !== "returning");
  const unknownSessions = unknown.reduce((n, r) => n + r.cur.sessions, 0);
  const totalSessions = res.data.total.cur.sessions;
  // Tempo de engajamento ÷ sessões, a partir da métrica extra pedida no relatório.
  const timePerSession = (r: (typeof groups)[number], which: "cur" | "prev") => {
    const raw = which === "cur" ? r.row.cur : r.row.prev;
    return raw?.sessions ? (raw.userEngagementDuration ?? 0) / raw.sessions : 0;
  };

  // O aviso de sessões sem classificação só aparece a partir de 3% do total.
  return (
    <div className="space-y-5">
      <MetaNotice meta={res.data.report.meta} />
      <AttributionNotice ctx={page.ctx} what="tipo de usuário" />
      {totalSessions > 0 && unknownSessions / totalSessions >= 0.03 && (
        <Notice tone="warning" title={`${fmtPct(unknownSessions / totalSessions, 0)} das sessões sem classificação`}>
          {fmtInt(unknownSessions)} sessões vieram com novo/recorrente vazio ou &quot;(not set)&quot;. Em app, isso costuma ser sessão
          aberta em segundo plano ou por notificação; ficam fora da comparação abaixo.
        </Notice>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        {groups.map((g) => (
          <section key={g.value} className="min-w-0">
            <CardHeader
              className="mb-3"
              title={LABELS[g.value] ?? g.value}
              subtitle={`${fmtPct(totalSessions ? g.cur.sessions / totalSessions : 0, 0)} das sessões`}
            />
            <KpiStrip count={6} cols={3}>
              <KpiTile label="Sessões" value={g.cur.sessions} prev={g.prev?.sessions} format="int" />
              <KpiTile
                label={terms.lead ? terms.conversion : "Conversão da sessão"}
                value={g.cur.conversion}
                prev={g.prev?.conversion}
                format="pct"
                note={terms.lead ? terms.conversionHelp : undefined}
              />
              <KpiTile label={terms.goal} value={g.cur.goals} prev={g.prev?.goals} format="int" />
              {terms.lead ? (
                <KpiTile label="Compras" value={g.cur.purchases} prev={g.prev?.purchases} format="int" />
              ) : (
                <KpiTile label={terms.ticket} value={g.cur.ticket} prev={g.prev?.ticket} format="brl" />
              )}
              <KpiTile label="Taxa de engajamento" value={g.cur.engagementRate} prev={g.prev?.engagementRate} format="pct" />
              <KpiTile
                label="Engajamento por sessão"
                value={timePerSession(g, "cur")}
                prev={g.prev ? timePerSession(g, "prev") : undefined}
                format="duration"
              />
            </KpiStrip>
          </section>
        ))}
      </div>
      <Card title="Tabela completa">
        <DataTable
          filename="novos-recorrentes"
          searchable={false}
          columns={[
            { key: "type", label: "Tipo", type: "dim" },
            { key: "sessions", label: "Sessões", type: "metric", format: "int", bar: true, delta: true },
            { key: "users", label: "Usuários", type: "metric", format: "int" },
            { key: "engagementRate", label: "Engajamento", type: "metric", format: "pct", delta: true },
            { key: "conversion", label: terms.conversion, type: "metric", format: "pct", delta: true, help: terms.conversionHelp },
            { key: "goals", label: terms.goal, type: "metric", format: "int", delta: true },
            ...(terms.lead
              ? []
              : ([
                  { key: "revenue", label: terms.revenue, type: "metric", format: "brl", delta: true },
                  { key: "ticket", label: terms.ticket, type: "metric", format: "brl", delta: true },
                ] as const)),
          ]}
          rows={res.data.rows.map(
            (r): TableRow => ({
              id: r.value || "vazio",
              values: {
                type: LABELS[r.value] ?? r.value,
                sessions: r.cur.sessions,
                users: r.cur.users,
                engagementRate: r.cur.engagementRate,
                conversion: r.cur.conversion,
                goals: r.cur.goals,
                revenue: r.cur.revenue,
                ticket: r.cur.ticket,
              },
              prev: r.prev
                ? {
                    sessions: r.prev.sessions,
                    engagementRate: r.prev.engagementRate,
                    conversion: r.prev.conversion,
                    goals: r.prev.goals,
                    revenue: r.prev.revenue,
                    ticket: r.prev.ticket,
                  }
                : undefined,
            }),
          )}
        />
      </Card>
    </div>
  );
}

/** Funil padrão da propriedade quebrado por novo x recorrente, com a taxa de passagem entre etapas. */
async function FunnelByType({ page }: { page: PageContext }) {
  const { steps } = await defaultFunnel(page.ctx);
  const res = await settle(runFunnel(page.ctx, steps, { breakdown: "newVsReturning" }));
  if (!res.ok) return <ErrorBlock message={res.error} />;
  const rows: TableRow[] = res.data.segments.map((seg) => {
    const values: TableRow["values"] = { segment: LABELS[seg.segment] ?? seg.segment };
    seg.steps.forEach((s, i) => {
      if (s.nextRate !== null) values[`p${i}`] = s.nextRate;
    });
    values.rate = seg.steps[0]?.users ? seg.steps.at(-1)!.users / seg.steps[0].users : 0;
    values.first = seg.steps[0]?.users ?? 0;
    return { id: seg.segment || "vazio", values };
  });
  return (
    <Card title="Funil de compra por tipo de usuário" subtitle="Taxa de passagem entre etapas (funil fechado).">
      <DataTable
        filename="funil-novos-recorrentes"
        searchable={false}
        columns={[
          { key: "segment", label: "Tipo", type: "dim" },
          { key: "first", label: steps[0]?.label ?? "Início", type: "metric", format: "int" },
          ...steps.slice(0, -1).map((s, i) => ({
            key: `p${i}`,
            label: `${s.label} → ${steps[i + 1].label}`,
            type: "metric" as const,
            format: "pct" as const,
          })),
          { key: "rate", label: "1ª → última", type: "metric", format: "pct", bar: true },
        ]}
        rows={rows}
      />
    </Card>
  );
}

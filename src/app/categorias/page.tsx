import { Suspense } from "react";

import { RateBars } from "@/components/charts/Charts";
import { FunnelHeatTable, type HeatRow } from "@/components/charts/FunnelHeatTable";
import { DashboardShell } from "@/components/shell/DashboardShell";
import { DataTable, type ColumnSpec, type TableRow } from "@/components/table/DataTable";
import { AttributionNotice } from "@/components/ui/AttributionNotice";
import { Card, DeltaPill, ErrorBlock, PageHeader, Skeleton } from "@/components/ui/primitives";
import { CATEGORIES, CATEGORY_HELP, PAGE_TYPES } from "@/lib/categories";
import { fmtCompact, fmtInt, fmtPct } from "@/lib/format";
import { aggPrevRate, aggRate, categoryReport, type CategoryReport, type GroupAgg } from "@/lib/ga4/briefing";
import { buildContext, type PageContext } from "@/lib/ga4/context";
import { settle } from "@/lib/ga4/report";
import { compareLabel, type SearchParams } from "@/lib/state";

/**
 * Categorias de produto: conversão, engajamento e avanço no simulador por categoria e tipo de
 * página. A categoria sai da página de entrada da sessão (regras em lib/categories), porque os
 * eventos do simulador não trazem o produto.
 */
export default async function CategoriesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = buildContext(await searchParams);
  return (
    <DashboardShell page={page} section="categorias">
      <PageHeader
        title="Categorias de produto"
        description="Comportamento e funil por categoria (imóveis, automóveis, motos) e por tipo de página, a partir da página em que a sessão começou."
      />
      <Suspense fallback={<Skeleton className="h-[720px]" />}>
        <Categories page={page} />
      </Suspense>
    </DashboardShell>
  );
}

/** Sessões engajadas ÷ sessões de um agregado. */
const engagement = (a: GroupAgg) => (a.sessions ? a.engaged / a.sessions : 0);

/** Corpo da página: cartões por categoria, gráficos de conversão, jornada e o cruzamento categoria x tipo. */
async function Categories({ page }: { page: PageContext }) {
  const res = await settle(categoryReport(page.ctx));
  if (!res.ok) return <ErrorBlock message={res.error} />;
  const r = res.data;
  const { terms } = r;
  const vs = page.ctx.comparison ? compareLabel(page.state) : undefined;
  const products = r.byCategory.filter((c) => c.key !== "Sem categoria" && c.sessions > 0);

  // Nos dois gráficos, abaixo de 60% da média do site a barra entra em "bem abaixo da média".
  return (
    <div className="space-y-5 2xl:space-y-6">
      <AttributionNotice ctx={page.ctx} what="categoria" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:gap-5">
        {r.byCategory
          .filter((c) => c.sessions > 0)
          .slice(0, 4)
          .map((c) => (
            <CategoryTile key={c.key} agg={c} report={r} vs={vs} />
          ))}
      </div>

      <div className="grid gap-5 2xl:gap-6 xl:grid-cols-2">
        <Card
          title={`${terms.conversion} por categoria`}
          subtitle={`Barra: ${terms.conversion.toLowerCase()} das sessões que começaram em páginas da categoria. A linha tracejada é a média do site (${fmtPct(r.total.conversion)}).`}
        >
          <RateBars
            points={r.byCategory
              .filter((c) => c.sessions > 0)
              .map((c) => ({ name: c.key, x: c.sessions, y: aggRate(c), flagged: c.sessions > 0 && aggRate(c) < r.total.conversion * 0.6 }))}
            xLabel="Sessões"
            yLabel={terms.conversion}
            xFormat="int"
            yFormat="pct"
            yRef={r.total.conversion}
            flaggedLabel="Bem abaixo da média"
            otherLabel="Categoria"
          />
        </Card>
        <Card
          title={`${terms.conversion} por tipo de página`}
          subtitle="O mesmo recorte pelo tipo da página de entrada: home, produto, consórcio, oferta, conteúdo e institucional."
        >
          <RateBars
            points={r.byType
              .filter((c) => c.sessions > 0)
              .map((c) => ({ name: c.key, x: c.sessions, y: aggRate(c), flagged: aggRate(c) < r.total.conversion * 0.6 }))}
            xLabel="Sessões"
            yLabel={terms.conversion}
            xFormat="int"
            yFormat="pct"
            yRef={r.total.conversion}
            flaggedLabel="Bem abaixo da média"
            otherLabel="Tipo de página"
          />
        </Card>
      </div>

      {r.steps && products.length > 0 && <JourneyByCategory report={r} />}

      <CompareTable report={r} />

      <Card title="Como a categoria é definida" subtitle="Pelo caminho da página de entrada. Os eventos do simulador não trazem a categoria do produto.">
        <dl className="grid gap-x-8 gap-y-3 text-[0.8125rem] sm:grid-cols-2 xl:grid-cols-3">
          {CATEGORIES.map((c) => (
            <div key={c}>
              <dt className="font-semibold text-ink">{c}</dt>
              <dd className="mt-0.5 text-ink-2">{CATEGORY_HELP[c]}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}

/** Cartão de uma categoria: conversão (com variação), fatia das sessões do site, meta e engajamento. */
function CategoryTile({ agg, report, vs }: { agg: GroupAgg; report: CategoryReport; vs?: string }) {
  const share = report.total.sessions ? agg.sessions / report.total.sessions : 0;
  const rate = aggRate(agg);
  const prevRate = report.hasPrev && agg.prevSessions ? aggPrevRate(agg) : undefined;
  return (
    <div className="refetch-dim flex min-w-0 flex-col rounded-2xl border border-line bg-surface p-5 shadow-card 2xl:p-6">
      <div className="flex items-start justify-between gap-3">
        <p className="truncate text-sm font-semibold text-ink">{agg.key}</p>
        {prevRate !== undefined && <DeltaPill cur={rate} prev={prevRate} />}
      </div>
      <p className="tabular mt-3 text-[2.25rem] leading-none font-bold tracking-[-0.035em] text-ink">{fmtPct(rate)}</p>
      <p className="mt-1.5 text-xs text-muted">
        {report.terms.conversion}
        {prevRate !== undefined && vs ? ` · ${vs}: ${fmtPct(prevRate)}` : ""}
      </p>
      <div className="mt-auto pt-5">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-ink-2">
            <strong className="font-semibold text-ink tabular">{fmtCompact(agg.sessions)}</strong> sessões
          </span>
          <span className="text-muted tabular">{fmtPct(share, 0)} do site</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden>
          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(share * 100, 1)}%` }} />
        </div>
        <p className="mt-2.5 text-xs text-ink-2">
          <strong className="font-semibold text-ink tabular">{fmtInt(agg.goals)}</strong> {report.terms.goalMany} ·{" "}
          {fmtPct(engagement(agg), 0)} de engajamento
        </p>
      </div>
    </div>
  );
}

/** Mapa de calor das telas do simulador por categoria. Só aparece quando a propriedade tem a jornada. */
function JourneyByCategory({ report }: { report: CategoryReport }) {
  const steps = report.steps!;
  const rows: HeatRow[] = report.byCategory
    .filter((c) => c.steps[0] > 0)
    .map((c) => ({ segment: c.key, siteUsers: c.sessions, users: c.steps }));
  const totalSteps = steps.map((_, i) => report.byCategory.reduce((n, c) => n + c.steps[i], 0));
  return (
    <Card
      title="Jornada do simulador por categoria"
      subtitle="Sessões que chegaram a cada tela do simulador, pela categoria da página de entrada. Não é funil fechado: compara o quanto cada categoria avança."
    >
      <FunnelHeatTable
        steps={steps.map((s) => s.label)}
        segmentLabel="Categoria"
        unit="sessões"
        siteLabel="Sessões"
        total={{ segment: "Total", siteUsers: report.total.sessions, users: totalSteps }}
        rows={rows}
      />
    </Card>
  );
}

/** Tabela com cada combinação de categoria e tipo de página de entrada que teve sessões. */
function CompareTable({ report }: { report: CategoryReport }) {
  const { terms } = report;
  const columns: ColumnSpec[] = [
    { key: "category", label: "Categoria", type: "dim" },
    { key: "type", label: "Tipo de página", type: "dim" },
    { key: "pages", label: "Páginas", type: "metric", format: "int" },
    { key: "sessions", label: "Sessões", type: "metric", format: "int", bar: true, delta: true },
    { key: "engagementRate", label: "Engajamento", type: "metric", format: "pct" },
    { key: "conversion", label: terms.conversion, type: "metric", format: "pct", delta: true, help: terms.conversionHelp },
    { key: "goals", label: terms.goal, type: "metric", format: "int", delta: true },
    ...(report.steps
      ? ([
          {
            key: "started",
            label: "Iniciaram simulação",
            type: "metric",
            format: "pct",
            help: "Sessões que chegaram à primeira tela do simulador ÷ sessões",
          },
        ] as ColumnSpec[])
      : []),
  ];
  const rows: TableRow[] = [];
  for (const c of CATEGORIES) {
    for (const t of PAGE_TYPES) {
      // Mesma chave que o categoryReport monta no mapa cruzado: categoria e tipo separados por \u0001.
      const a = report.cross.get(`${c}\u0001${t}`);
      if (!a || a.sessions === 0) continue;
      rows.push({
        id: `${c}-${t}`,
        values: {
          category: c,
          type: t,
          pages: a.pages,
          sessions: a.sessions,
          engagementRate: engagement(a),
          conversion: aggRate(a),
          goals: a.goals,
          started: a.sessions ? (a.steps[0] ?? 0) / a.sessions : null,
        },
        prev: report.hasPrev ? { sessions: a.prevSessions, conversion: aggPrevRate(a), goals: a.prevGoals } : undefined,
      });
    }
  }
  return (
    <Card title="Categoria x tipo de página" subtitle="Cada combinação de categoria e tipo de página de entrada, para achar onde a mesma categoria converte melhor.">
      <DataTable filename="categorias-tipos" columns={columns} rows={rows} initialSort={{ key: "sessions" }} pageSize={20} />
    </Card>
  );
}

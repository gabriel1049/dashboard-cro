import { Suspense } from "react";

import { OpportunityMatrix } from "@/components/charts/Charts";
import { DashboardShell } from "@/components/shell/DashboardShell";
import { DataTable, type TableRow } from "@/components/table/DataTable";
import { MetaNotice } from "@/components/ui/MetaNotice";
import { Card, ErrorBlock, Notice, PageHeader, Skeleton } from "@/components/ui/primitives";
import { SectionTabs } from "@/components/ui/SectionTabs";
import { PRODUCT_DIMENSIONS } from "@/config/cro";
import { fmtPct } from "@/lib/format";
import { buildContext, type PageContext } from "@/lib/ga4/context";
import { getTerms } from "@/lib/ga4/kpis";
import { getMetadata } from "@/lib/ga4/metadata";
import { runReport, settle } from "@/lib/ga4/report";
import type { SearchParams } from "@/lib/state";

// Métricas de item do e-commerce do GA4; só entram as que a propriedade tem.
const ITEM_METRICS = ["itemsViewed", "itemsCheckedOut", "itemsPurchased", "itemRevenue"];

/** Mediana dos valores acima de zero, para item sem volume não puxar a referência para baixo. */
const median = (xs: number[]) => {
  const s = xs.filter((x) => x > 0).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/**
 * Produtos: visualizações, checkouts e compras por item (métricas de e-commerce do GA4), com alerta
 * para item muito visto e pouco levado ao checkout. Sem adição ao carrinho, que não existe na
 * jornada do consórcio: o plano vai da visualização direto para o checkout.
 */
export default async function ProductsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const page = buildContext(sp);
  const md = await getMetadata(page.ctx.propertyId).catch(() => null);
  const dims = PRODUCT_DIMENSIONS.filter((d) => md?.dimensions.has(d.id));
  const dim = dims.find((d) => d.id === sp.dim) ?? dims[0];
  const metrics = ITEM_METRICS.filter((m) => md?.metrics.has(m));
  return (
    <DashboardShell page={page} section="produtos">
      <PageHeader
        title="Produtos"
        description="Visualizações, checkouts e compras por item. Destaca os itens muito vistos e pouco levados ao checkout."
      />
      <Suspense fallback={<Skeleton className="h-[600px]" />}>
        <ProductBlock page={page} dim={dim} dims={dims} metrics={metrics} />
      </Suspense>
    </DashboardShell>
  );
}

/** Matriz visualização x checkout e a tabela por item, na dimensão escolhida em ?dim. */
async function ProductBlock({
  page,
  dim,
  dims,
  metrics,
}: {
  page: PageContext;
  dim: { id: string; label: string };
  dims: { id: string; label: string }[];
  metrics: string[];
}) {
  const terms = getTerms();
  const tabs = <SectionTabs param="dim" label="Dimensão" options={dims} current={dim.id} />;
  const res = await settle(
    runReport(page.ctx, { dimensions: [dim.id], metrics, orderBy: { metric: "itemsViewed" }, limit: 300, totals: true }),
  );
  if (!res.ok) {
    return (
      <Card title={dim.label} actions={tabs}>
        <ErrorBlock message={res.error} />
      </Card>
    );
  }
  const t = res.data.totals.cur;
  const avgCheckout = t.itemsViewed ? (t.itemsCheckedOut ?? 0) / t.itemsViewed : 0;
  const medViews = median(res.data.rows.map((r) => r.cur.itemsViewed ?? 0));
  let impossible = 0;
  // Compras em itens que nunca aparecem visualizados: o purchase usa outros nomes de item.
  const orphanPurchases = res.data.rows
    .filter((r) => !(r.cur.itemsViewed ?? 0))
    .reduce((n, r) => n + (r.cur.itemsPurchased ?? 0), 0);
  const orphanShare = t.itemsPurchased ? orphanPurchases / t.itemsPurchased : 0;
  const orphanNames = res.data.rows
    .filter((r) => !(r.cur.itemsViewed ?? 0) && (r.cur.itemsPurchased ?? 0) > 0)
    .slice(0, 3)
    .map((r) => r.dims[dim.id]);

  const rows: TableRow[] = res.data.rows.map((r) => {
    const v = r.cur;
    const views = v.itemsViewed ?? 0;
    const checkout = v.itemsCheckedOut ?? 0;
    const bought = v.itemsPurchased ?? 0;
    const checkoutRate = views ? checkout / views : null;
    const flags: TableRow["flags"] = [];
    // Taxa acima de 100% é erro de tracking e dispensa o alerta. O outro alerta pede volume
    // (mediana e um piso) e taxa abaixo da metade da média.
    if (checkoutRate !== null && checkoutRate > 1) {
      impossible++;
      flags.push({ label: "Mais checkout que visualização: verificar tracking", tone: "warning" });
    } else if (views >= medViews && views >= 50 && checkoutRate !== null && checkoutRate < avgCheckout * 0.5) {
      flags.push({ label: "Muito visto, pouco checkout", tone: "critical" });
    }
    return {
      id: r.key,
      values: { item: r.dims[dim.id], views, checkout, bought, revenue: v.itemRevenue ?? 0, checkoutRate },
      prev: r.prev
        ? { views: r.prev.itemsViewed, checkout: r.prev.itemsCheckedOut, bought: r.prev.itemsPurchased, revenue: r.prev.itemRevenue }
        : undefined,
      flags,
    };
  });

  return (
    <div className="space-y-5">
      <MetaNotice meta={res.data.meta} />
      {orphanShare >= 0.5 && (
        <Notice tone="warning" title="A compra usa outros nomes de item">
          {fmtPct(orphanShare, 0)} dos itens comprados não aparecem em nenhuma visualização (ex.: {orphanNames.join(", ")}). O purchase
          manda o tipo de plano no lugar do produto visto, então a compra por item não se liga à visualização. Por isso a matriz
          compara visualização com checkout, que usa os mesmos nomes. Vale padronizar item_name e item_id no purchase.
        </Notice>
      )}
      {impossible > 0 && (
        <Notice tone="warning" title="Taxas acima de 100%">
          {impossible} {impossible === 1 ? "item tem" : "itens têm"} mais checkouts do que visualizações. Isso costuma acontecer
          quando o mesmo produto tem nomes diferentes em cada evento (ex.: um nome no view_item e outro no begin_checkout) ou
          quando o checkout é disparado sem passar pela página do item. Vale padronizar item_name e item_id.
        </Notice>
      )}
      <Card
        title="Visualização x checkout"
        subtitle={`Média: ${fmtPct(avgCheckout)} das visualizações viram checkout.${
          impossible ? ` ${impossible} ${impossible === 1 ? "item com taxa acima de 100% fica" : "itens com taxa acima de 100% ficam"} fora do gráfico.` : ""
        }`}
        actions={tabs}
      >
        <OpportunityMatrix
          points={rows
            // Taxas acima de 100% são erro de tracking (avisado acima) e achatariam o gráfico.
            .filter((r) => (r.values.views as number) > 0 && ((r.values.checkoutRate as number | null) ?? 0) <= 1)
            .map((r) => ({
              name: String(r.values.item),
              x: r.values.views as number,
              y: (r.values.checkoutRate as number) ?? 0,
              flagged: Boolean(r.flags?.some((f) => f.tone === "critical")),
            }))}
          xLabel="Visualizações do item"
          yLabel="Checkout ÷ visualização"
          xFormat="int"
          yFormat="pct"
          yRef={avgCheckout}
          flaggedLabel="Muito visto, pouco checkout"
        />
      </Card>
      <Card title={`Desempenho por ${dim.label.toLowerCase()}`}>
        <DataTable
          filename={`produtos-${dim.id}`}
          initialSort={{ key: "views" }}
          columns={[
            { key: "item", label: dim.label, type: "dim" },
            { key: "views", label: "Visualizações", type: "metric", format: "int", bar: true, delta: true },
            { key: "checkout", label: "Checkouts", type: "metric", format: "int", delta: true, help: "itemsCheckedOut" },
            { key: "checkoutRate", label: "Checkout ÷ visualização", type: "metric", format: "pct" },
            { key: "bought", label: "Compras", type: "metric", format: "int", delta: true },
            { key: "revenue", label: terms.revenue, type: "metric", format: "brl" },
          ]}
          rows={rows}
        />
      </Card>
    </div>
  );
}

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
const ITEM_METRICS = ["itemsViewed", "itemsAddedToCart", "itemsPurchased", "itemRevenue", "cartToViewRate", "purchaseToViewRate"];

/** Mediana dos valores acima de zero, para item sem volume não puxar a referência para baixo. */
const median = (xs: number[]) => {
  const s = xs.filter((x) => x > 0).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/**
 * Produtos: visualizações, carrinho e compras por item (métricas de e-commerce do GA4), com alerta
 * para item muito visto e pouco adicionado, ou muito adicionado e pouco comprado.
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
        description="Visualizações, adições ao carrinho e compras por item. Destaca itens muito vistos e pouco adicionados, e itens muito adicionados e pouco comprados."
      />
      <Suspense fallback={<Skeleton className="h-[600px]" />}>
        <ProductBlock page={page} dim={dim} dims={dims} metrics={metrics} />
      </Suspense>
    </DashboardShell>
  );
}

/** Matriz visualização x carrinho e a tabela por item, na dimensão escolhida em ?dim. */
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
  const avgCart = t.itemsViewed ? (t.itemsAddedToCart ?? 0) / t.itemsViewed : 0;
  const avgBuy = t.itemsAddedToCart ? (t.itemsPurchased ?? 0) / t.itemsAddedToCart : 0;
  const medViews = median(res.data.rows.map((r) => r.cur.itemsViewed ?? 0));
  const medCart = median(res.data.rows.map((r) => r.cur.itemsAddedToCart ?? 0));
  let impossible = 0;

  const rows: TableRow[] = res.data.rows.map((r) => {
    const v = r.cur;
    const views = v.itemsViewed ?? 0;
    const cart = v.itemsAddedToCart ?? 0;
    const bought = v.itemsPurchased ?? 0;
    const cartRate = views ? cart / views : null;
    const buyRate = cart ? bought / cart : null;
    const flags: TableRow["flags"] = [];
    // Taxa acima de 100% é erro de tracking e dispensa o alerta de "pouco adicionado". Os outros
    // alertas pedem volume (mediana e um piso) e taxa abaixo da metade da média.
    if (cartRate !== null && cartRate > 1) {
      impossible++;
      flags.push({ label: "Mais carrinho que visualização: verificar tracking", tone: "warning" });
    } else if (views >= medViews && views >= 50 && cartRate !== null && cartRate < avgCart * 0.5) {
      flags.push({ label: "Muito visto, pouco adicionado", tone: "critical" });
    }
    if (cart >= medCart && cart >= 30 && buyRate !== null && buyRate < avgBuy * 0.5) {
      flags.push({ label: "Muito adicionado, pouco comprado", tone: "critical" });
    }
    // Usa as taxas do GA4 quando a propriedade tem as métricas; senão, calcula pelas contagens.
    return {
      id: r.key,
      values: {
        item: r.dims[dim.id],
        views,
        cart,
        bought,
        revenue: v.itemRevenue ?? 0,
        cartRate: v.cartToViewRate ?? cartRate,
        buyRate,
        purchaseToView: v.purchaseToViewRate ?? (views ? bought / views : null),
      },
      prev: r.prev
        ? { views: r.prev.itemsViewed, cart: r.prev.itemsAddedToCart, bought: r.prev.itemsPurchased, revenue: r.prev.itemRevenue }
        : undefined,
      flags,
    };
  });

  return (
    <div className="space-y-5">
      <MetaNotice meta={res.data.meta} />
      {impossible > 0 && (
        <Notice tone="warning" title="Taxas acima de 100%">
          {impossible} {impossible === 1 ? "item tem" : "itens têm"} mais adições ao carrinho do que visualizações. Isso costuma
          acontecer quando o mesmo produto tem nomes diferentes em cada evento (ex.: um nome no view_item e outro no
          add_to_cart) ou quando o carrinho é disparado sem passar pela página do item. Vale padronizar item_name e item_id.
        </Notice>
      )}
      <Card
        title="Visualização x adição ao carrinho"
        subtitle={`Média: ${fmtPct(avgCart)} das visualizações viram carrinho e ${fmtPct(avgBuy)} dos carrinhos viram compra.${
          impossible ? ` ${impossible} ${impossible === 1 ? "item com taxa acima de 100% fica" : "itens com taxa acima de 100% ficam"} fora do gráfico.` : ""
        }`}
        actions={tabs}
      >
        <OpportunityMatrix
          points={rows
            // Taxas acima de 100% são erro de tracking (avisado acima) e achatariam o gráfico.
            .filter((r) => (r.values.views as number) > 0 && ((r.values.cartRate as number | null) ?? 0) <= 1)
            .map((r) => ({
              name: String(r.values.item),
              x: r.values.views as number,
              y: (r.values.cartRate as number) ?? 0,
              flagged: Boolean(r.flags?.some((f) => f.tone === "critical")),
            }))}
          xLabel="Visualizações do item"
          yLabel="Carrinho ÷ visualização"
          xFormat="int"
          yFormat="pct"
          yRef={avgCart}
          flaggedLabel="Muito visto, pouco adicionado / pouco comprado"
        />
      </Card>
      <Card title={`Desempenho por ${dim.label.toLowerCase()}`}>
        <DataTable
          filename={`produtos-${dim.id}`}
          initialSort={{ key: "views" }}
          columns={[
            { key: "item", label: dim.label, type: "dim" },
            { key: "views", label: "Visualizações", type: "metric", format: "int", bar: true, delta: true },
            { key: "cart", label: "Adições ao carrinho", type: "metric", format: "int", delta: true },
            { key: "bought", label: "Compras", type: "metric", format: "int", delta: true },
            { key: "revenue", label: terms.revenue, type: "metric", format: "brl" },
            { key: "cartRate", label: "Carrinho ÷ visualização", type: "metric", format: "pct", help: "cartToViewRate" },
            { key: "buyRate", label: "Compra ÷ carrinho", type: "metric", format: "pct" },
            { key: "purchaseToView", label: "Compra ÷ visualização", type: "metric", format: "pct", help: "purchaseToViewRate" },
          ]}
          rows={rows}
        />
      </Card>
    </div>
  );
}

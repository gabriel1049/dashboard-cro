import { Suspense } from "react";

import { ShareBars } from "@/components/charts/Charts";
import { DashboardShell } from "@/components/shell/DashboardShell";
import { DataTable } from "@/components/table/DataTable";
import { AttributionNotice } from "@/components/ui/AttributionNotice";
import { MetaNotice } from "@/components/ui/MetaNotice";
import { Card, ErrorBlock, PageHeader, Skeleton } from "@/components/ui/primitives";
import { SectionTabs } from "@/components/ui/SectionTabs";
import { CHANNEL_DIMENSIONS } from "@/config/cro";
import { fmtPct } from "@/lib/format";
import { buildContext, type PageContext } from "@/lib/ga4/context";
import { croByDimension, effectiveGoal } from "@/lib/ga4/kpis";
import { getMetadata } from "@/lib/ga4/metadata";
import { settle } from "@/lib/ga4/report";
import type { SearchParams } from "@/lib/state";
import { croColumns, croRow } from "@/lib/views";

/**
 * Canais: conversão e participação por canal, origem/mídia ou campanha (a aba vem de ?dim).
 * Só oferece as dimensões que existem na propriedade, segundo o getMetadata do GA4.
 */
export default async function ChannelsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const page = buildContext(sp);
  const [md, goal] = await Promise.all([
    getMetadata(page.ctx.propertyId).catch(() => null),
    effectiveGoal(page.ctx).catch(() => "compra" as const),
  ]);
  const dims = CHANNEL_DIMENSIONS.filter((d) => md?.dimensions.has(d.id));
  const dim = dims.find((d) => d.id === sp.dim) ?? dims[0];
  return (
    <DashboardShell page={page} section="canais">
      <PageHeader
        title="Canais"
        description={
          goal === "lead"
            ? "Taxa de lead e leads por canal, origem/mídia e campanha. A comparação de participação mostra quem traz tráfego e quem traz lead."
            : "Conversão, compras e ticket por canal, origem/mídia e campanha. A comparação de participação mostra quem traz tráfego e quem traz compra."
        }
      />
      <Suspense fallback={<Skeleton className="h-[600px]" />}>
        <ChannelBlock page={page} dim={dim} dims={dims} />
      </Suspense>
    </DashboardShell>
  );
}

/** Participação nas sessões x na meta das 10 maiores linhas e a tabela completa, com alertas por linha. */
async function ChannelBlock({
  page,
  dim,
  dims,
}: {
  page: PageContext;
  dim: { id: string; label: string };
  dims: { id: string; label: string }[];
}) {
  const res = await settle(croByDimension(page.ctx, dim.id, { limit: 200 }));
  const tabs = <SectionTabs param="dim" label="Dimensão" options={dims} current={dim.id} />;
  if (!res.ok) {
    return (
      <Card title={dim.label} actions={tabs}>
        <ErrorBlock message={res.error} />
      </Card>
    );
  }
  const { terms } = res.data;
  const total = res.data.total.cur;
  const top = res.data.rows.slice(0, 10);
  const filterKey = dim.id === "sessionDefaultChannelGroup" ? ("canal" as const) : undefined;
  const shareLabel = terms.lead ? "% dos leads" : "% das compras";

  return (
    <div className="space-y-5">
      <MetaNotice meta={res.data.report.meta} />
      <AttributionNotice ctx={page.ctx} what="canal" />
      <Card
        title={`Participação nas sessões x ${terms.lead ? "nos leads" : "nas compras"}`}
        subtitle={`Top 10 por sessões. Quando a barra de ${terms.goalMany} é maior que a de sessões, o ${dim.label.toLowerCase()} converte acima da média (${fmtPct(total.conversion)}).`}
        actions={tabs}
      >
        <ShareBars
          categories={top.map((r) => r.value)}
          a={{ label: "% das sessões", values: top.map((r) => (total.sessions ? r.cur.sessions / total.sessions : 0)) }}
          b={{ label: shareLabel, values: top.map((r) => (total.goals ? r.cur.goals / total.goals : 0)) }}
          filterKey={filterKey}
        />
      </Card>
      <Card title={`Desempenho por ${dim.label.toLowerCase()}`}>
        <DataTable
          filename={`canais-${dim.id}`}
          columns={croColumns(terms, { key: "value", label: dim.label, filterKey })}
          rows={res.data.rows.map((r) => {
            const share = total.sessions ? r.cur.sessions / total.sessions : 0;
            // Alerta só com volume: 5% das sessões convertendo a metade da média ou menos, ou
            // 2% das sessões convertendo 1,5x a média ou mais.
            const flags =
              share >= 0.05 && total.conversion > 0 && r.cur.conversion <= total.conversion * 0.5
                ? [{ label: terms.lead ? "Muito tráfego, pouco lead" : "Muito tráfego, pouca compra", tone: "warning" as const }]
                : share >= 0.02 && r.cur.conversion >= total.conversion * 1.5
                  ? [{ label: "Converte acima da média", tone: "good" as const }]
                  : [];
            return croRow(r.value, "value", r.value, r.cur, r.prev, flags);
          })}
          initialSort={{ key: "sessions" }}
        />
      </Card>
    </div>
  );
}

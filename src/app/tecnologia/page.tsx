import { Suspense } from "react";

import { OpportunityMatrix } from "@/components/charts/Charts";
import { DashboardShell } from "@/components/shell/DashboardShell";
import { DataTable, type TableRow } from "@/components/table/DataTable";
import { AttributionNotice } from "@/components/ui/AttributionNotice";
import { MetaNotice } from "@/components/ui/MetaNotice";
import { Card, ErrorBlock, Notice, PageHeader, Skeleton } from "@/components/ui/primitives";
import { SectionTabs } from "@/components/ui/SectionTabs";
import { ERROR_EVENTS, MIN_SESSIONS_FOR_ALERT, TECH_DIMENSIONS } from "@/config/cro";
import { fmtInt, fmtPct } from "@/lib/format";
import { buildContext, type PageContext } from "@/lib/ga4/context";
import { croByDimension, usersByEvent } from "@/lib/ga4/kpis";
import { getMetadata } from "@/lib/ga4/metadata";
import { mergeMeta, settle } from "@/lib/ga4/report";
import { FILTERS, type FilterKey, type SearchParams } from "@/lib/state";
import { inventory90 } from "@/lib/views";

/**
 * Dispositivo e tecnologia: conversão, abandono de checkout e erros por dispositivo, sistema,
 * versão ou aparelho (?dim). Conversão muito abaixo da média numa combinação costuma ser bug.
 */
export default async function TechPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const page = buildContext(sp);
  const md = await getMetadata(page.ctx.propertyId).catch(() => null);
  const dims = TECH_DIMENSIONS.filter((d) => md?.dimensions.has(d.id));
  const dim = dims.find((d) => d.id === sp.dim) ?? dims[0];

  return (
    <DashboardShell page={page} section="tecnologia">
      <PageHeader
        title="Dispositivo e tecnologia"
        description="Conversão, abandono de checkout e erros por dispositivo, sistema, versão e aparelho. Combinações com conversão muito abaixo da média costumam indicar bug."
      />
      <Suspense fallback={<Skeleton className="h-[640px]" />}>
        {dim ? <TechBlock page={page} dim={dim} dims={dims} /> : <ErrorBlock message="Nenhuma dimensão de tecnologia disponível." />}
      </Suspense>
    </DashboardShell>
  );
}

/** Matriz sessões x conversão e tabela da dimensão escolhida, com checkout e erros por linha. */
async function TechBlock({
  page,
  dim,
  dims,
}: {
  page: PageContext;
  dim: { id: string; label: string };
  dims: { id: string; label: string }[];
}) {
  const { ctx } = page;
  const inv = await inventory90(ctx).catch(() => []);
  // Só pede ao GA4 os eventos que existiram nos últimos 90 dias.
  const present = new Set(inv.map((e) => e.event));
  const errorEvents = ERROR_EVENTS.filter((e) => present.has(e));
  const events = ["begin_checkout", "purchase", ...errorEvents].filter((e) => present.has(e));

  const [base, byEvent] = await Promise.all([
    settle(croByDimension(ctx, dim.id, { limit: 100 })),
    events.length ? settle(usersByEvent(ctx, dim.id, events)) : null,
  ]);
  const tabs = <SectionTabs param="dim" label="Dimensão" options={dims} current={dim.id} />;
  if (!base.ok) {
    return (
      <Card title={dim.label} actions={tabs}>
        <ErrorBlock message={base.error} />
      </Card>
    );
  }

  const { terms } = base.data;
  const ev = byEvent?.ok ? byEvent.data.map : new Map<string, Record<string, number>>();
  const total = base.data.total.cur;
  const sum = (key: string) => [...ev.values()].reduce((n, v) => n + (v[key] ?? 0), 0);
  // Usuários com erro = o maior entre os eventos de erro, para não contar duas vezes a mesma pessoa.
  const errUsersOf = (v: Record<string, number> | undefined) => Math.max(0, ...errorEvents.map((e) => v?.[e] ?? 0));
  const totalErrUsers = Math.max(0, ...errorEvents.map((e) => sum(e)));
  const overallErrRate = total.users ? totalErrUsers / total.users : 0;
  // Só dá para medir abandono quando a compra acontece depois do checkout. Se há mais compradores que
  // usuários em begin_checkout, o purchase dispara fora do fluxo e a conta ficaria negativa.
  const checkoutUsers = sum("begin_checkout");
  const purchaseUsers = sum("purchase");
  const hasCheckout = events.includes("begin_checkout");
  const checkoutReliable = hasCheckout && checkoutUsers > 0 && purchaseUsers <= checkoutUsers;
  const overallAbandon = checkoutReliable ? 1 - purchaseUsers / checkoutUsers : 0;
  // Piso de volume para alerta: o mínimo do config ou 1% das sessões, o que for maior.
  const minSessions = Math.max(MIN_SESSIONS_FOR_ALERT, total.sessions * 0.01);
  const filterKey = FILTERS.find((f) => f.dimension === dim.id)?.key as FilterKey | undefined;

  const rows: TableRow[] = base.data.rows.map((r) => {
    const e = ev.get(r.value);
    const checkout = e?.begin_checkout ?? 0;
    const abandon = checkoutReliable && checkout >= 20 ? Math.max(0, 1 - (e?.purchase ?? 0) / checkout) : null;
    const errRate = r.cur.users ? errUsersOf(e) / r.cur.users : 0;
    // Alertas: conversão abaixo da metade da média, abandono 20 pontos acima do geral (30+ checkouts)
    // e erro acima do dobro da média (300+ usuários).
    const flags: TableRow["flags"] = [];
    if (r.cur.sessions >= minSessions && total.conversion > 0 && r.cur.conversion < total.conversion * 0.5) {
      flags.push({
        label: `${terms.conversion} ${fmtPct(1 - r.cur.conversion / total.conversion, 0)} abaixo · possível bug`,
        tone: "critical",
      });
    }
    if (abandon !== null && checkout >= 30 && abandon > overallAbandon + 0.2) {
      flags.push({ label: "Abandono de checkout alto", tone: "warning" });
    }
    if (errorEvents.length && r.cur.users >= 300 && overallErrRate > 0 && errRate > overallErrRate * 2) {
      flags.push({ label: "Erros acima da média", tone: "warning" });
    }
    return {
      id: r.value,
      values: {
        value: r.value,
        sessions: r.cur.sessions,
        users: r.cur.users,
        conversion: r.cur.conversion,
        goals: r.cur.goals,
        revenue: r.cur.revenue,
        abandon,
        errRate: errorEvents.length ? errRate : null,
      },
      prev: r.prev ? { sessions: r.prev.sessions, conversion: r.prev.conversion, goals: r.prev.goals } : undefined,
      flags,
    };
  });

  // No gráfico entram linhas com pelo menos um quinto do piso de alerta.
  const points = rows
    .filter((r) => (r.values.sessions as number) >= minSessions / 5)
    .map((r) => ({
      name: String(r.values.value),
      x: r.values.sessions as number,
      y: r.values.conversion as number,
      flagged: Boolean(r.flags?.some((f) => f.tone === "critical")),
    }));

  return (
    <div className="space-y-5">
      <AttributionNotice ctx={ctx} what="dispositivo e tecnologia" />
      <Card
        title={`${terms.conversion} por ${dim.label.toLowerCase()}`}
        subtitle={`Média do período: ${fmtPct(total.conversion)} das sessões com ${terms.goalOne}${
          checkoutReliable ? ` · abandono de checkout ${fmtPct(overallAbandon)}` : ""
        }${errorEvents.length ? ` · ${fmtPct(overallErrRate)} dos usuários com erro` : ""}`}
        actions={tabs}
      >
        <MetaNotice meta={mergeMeta(base.data.report.meta, byEvent?.ok ? byEvent.data.meta : undefined)} />
        {hasCheckout && !checkoutReliable && checkoutUsers > 0 && (
          <div className="mb-4">
            <Notice tone="warning" title="Abandono de checkout não calculado">
              Há mais usuários com compra ({fmtInt(purchaseUsers)}) do que usuários que iniciaram o checkout ({fmtInt(checkoutUsers)}). O
              evento purchase está disparando fora do fluxo de checkout, então a taxa de abandono sairia negativa. Detalhes em Qualidade
              dos dados.
            </Notice>
          </div>
        )}
        {points.length > 2 && (
          <div className="mb-5">
            <OpportunityMatrix
              points={points}
              xLabel="Sessões"
              yLabel={terms.conversion}
              xFormat="int"
              yFormat="pct"
              yRef={total.conversion}
              flaggedLabel={`${terms.conversion} muito abaixo da média`}
            />
          </div>
        )}
        <DataTable
          filename={`tecnologia-${dim.id}`}
          initialSort={{ key: "sessions" }}
          columns={[
            { key: "value", label: dim.label, type: "dim", filterKey },
            { key: "sessions", label: "Sessões", type: "metric", format: "int", bar: true, delta: true },
            { key: "users", label: "Usuários", type: "metric", format: "int" },
            { key: "conversion", label: terms.conversion, type: "metric", format: "pct", delta: true, help: terms.conversionHelp },
            { key: "goals", label: terms.goal, type: "metric", format: "int", delta: true },
            ...(terms.lead ? [] : [{ key: "revenue", label: terms.revenue, type: "metric" as const, format: "brl" as const }]),
            ...(checkoutReliable
              ? [
                  {
                    key: "abandon",
                    label: "Abandono checkout",
                    type: "metric" as const,
                    format: "pct" as const,
                    help: "1 − usuários com compra ÷ usuários que iniciaram checkout (mínimo de 20)",
                  },
                ]
              : []),
            ...(errorEvents.length
              ? [
                  {
                    key: "errRate",
                    label: "Usuários com erro",
                    type: "metric" as const,
                    format: "pct" as const,
                    help: `Usuários com ${errorEvents.join(" ou ")} ÷ usuários`,
                  },
                ]
              : []),
          ]}
          rows={rows}
        />
      </Card>
    </div>
  );
}

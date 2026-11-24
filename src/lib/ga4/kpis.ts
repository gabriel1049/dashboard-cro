import "server-only";

import { addDays, type Goal } from "../state";
import { cached } from "./cache";
import { getMetadata } from "./metadata";
import { ATTRIBUTION_ALERT, purchaseAttribution } from "../quality";
import { inList, runReport, type QueryContext, type ReportRow, type Values } from "./report";

/**
 * Nomes exibidos. Receita: valor do evento purchase (CRO_REVENUE_LABEL troca o rótulo).
 * Meta: os rótulos de conversão e da contagem seguem a meta escolhida (compra ou lead).
 */
export function getTerms(goal: Goal = "compra") {
  const revenue = process.env.CRO_REVENUE_LABEL?.trim() || "Receita";
  const lead = goal === "lead";
  return {
    revenue,
    ticket: process.env.CRO_TICKET_LABEL?.trim() || "Ticket médio",
    revenuePerUser: `${revenue} por usuário`,
    lead,
    /** Contagem da meta, no plural (título de coluna e de KPI). */
    goal: lead ? "Leads" : "Compras",
    /** Meta no singular, minúscula, para frases. */
    goalOne: lead ? "lead" : "compra",
    /** Meta no plural, minúscula, para frases. */
    goalMany: lead ? "leads" : "compras",
    conversion: lead ? "Taxa de lead" : "Conversão",
    conversionHelp: lead ? "Sessões com lead ÷ sessões" : "Sessões com compra ÷ sessões",
  };
}
export type Terms = ReturnType<typeof getTerms>;

export const CONVERSION_METRIC = "sessionKeyEventRate:purchase";

/** Evento de lead (CRO_LEAD_EVENT, padrão generate_lead). */
export function leadEvent() {
  return process.env.CRO_LEAD_EVENT?.trim() || "generate_lead";
}

/** A meta "lead" só existe quando o evento de lead é evento-chave na propriedade. */
export async function leadAvailable(propertyId: string) {
  const md = await getMetadata(propertyId);
  const ev = leadEvent();
  return md.metrics.has(`sessionKeyEventRate:${ev}`) && md.metrics.has(`keyEvents:${ev}`);
}

/**
 * Primeiro dia em que o evento de lead conta como evento-chave (últimos 400 dias). O GA4 não recalcula
 * eventos-chave para trás: antes dessa data, keyEvents e sessionKeyEventRate do lead vêm zerados.
 */
export function leadKeyEventStart(ctx: QueryContext): Promise<string | null> {
  const ev = leadEvent();
  return cached(`leadstart:${ctx.propertyId}:${ev}:${ctx.today}`, 3 * 3600_000, async () => {
    const metric = `keyEvents:${ev}`;
    const r = await runReport(ctx, {
      dimensions: ["date"],
      metrics: [metric],
      globalFilters: false,
      range: { start: addDays(ctx.today, -400), end: addDays(ctx.today, -1) },
      orderBy: { dimension: "date" },
      limit: 500,
    });
    const first = r.rows
      .filter((row) => (row.cur[metric] ?? 0) > 0)
      .map((row) => row.dims.date)
      .sort()[0];
    return first ? `${first.slice(0, 4)}-${first.slice(4, 6)}-${first.slice(6, 8)}` : null;
  });
}

/** De onde vem a conversão da meta: taxa por sessão do GA4 (rateMetric) ou contagem ÷ sessões. */
export type GoalSource = {
  goal: Goal;
  rateMetric: string | null;
  countMetric: string;
  derived: boolean;
  reason: "no-key-event" | "unattributed" | null;
};

/**
 * Lead: sessionKeyEventRate:<evento> (sessões com lead ÷ sessões) e keyEvents:<evento>.
 *
 * Compra: sessionKeyEventRate:purchase quando o purchase é evento-chave (não infla com compras
 * duplicadas). Cai para compras / sessões quando o purchase não é evento-chave ou quando boa parte
 * das compras chega sem sessão (enviada pelo servidor): nesse caso a taxa por sessão vai a zero
 * sem a venda ter caído.
 *
 * Meta "lead" pedida numa propriedade sem o evento-chave de lead vira "compra".
 */
export async function conversionSource(ctx: QueryContext): Promise<GoalSource> {
  if (ctx.goal === "lead" && (await leadAvailable(ctx.propertyId))) {
    const ev = leadEvent();
    return {
      goal: "lead",
      rateMetric: `sessionKeyEventRate:${ev}`,
      countMetric: `keyEvents:${ev}`,
      derived: false,
      reason: null,
    };
  }
  const purchase = { goal: "compra" as const, countMetric: "ecommercePurchases" };
  const md = await getMetadata(ctx.propertyId);
  if (!md.metrics.has(CONVERSION_METRIC)) return { ...purchase, rateMetric: null, derived: true, reason: "no-key-event" };
  const periods = [ctx.current, ...(ctx.comparison ? [ctx.comparison] : [])];
  const shares = await Promise.all(
    periods.map((range) =>
      purchaseAttribution(ctx, range)
        .then((a) => (a.total >= 20 ? a.share : 0))
        .catch(() => 0),
    ),
  );
  return shares.some((s) => s >= ATTRIBUTION_ALERT)
    ? { ...purchase, rateMetric: null, derived: true, reason: "unattributed" }
    : { ...purchase, rateMetric: CONVERSION_METRIC, derived: false, reason: null };
}

/** Meta efetiva (a pedida, ou "compra" quando a propriedade não tem lead). */
export async function effectiveGoal(ctx: QueryContext): Promise<Goal> {
  return ctx.goal === "lead" && (await leadAvailable(ctx.propertyId)) ? "lead" : "compra";
}

export function conversionOf(v: Values | undefined, src: GoalSource): number {
  if (!v) return 0;
  if (src.rateMetric) return v[src.rateMetric] ?? 0;
  return v.sessions ? (v[src.countMetric] ?? 0) / v.sessions : 0;
}

/** Métricas base de CRO de uma linha, com derivadas (ticket, receita por usuário). */
export function cro(v: Values | undefined, src: GoalSource) {
  const x = v ?? {};
  const purchases = x.ecommercePurchases ?? 0;
  return {
    sessions: x.sessions ?? 0,
    users: x.totalUsers ?? 0,
    engagementRate: x.engagementRate ?? 0,
    /** Conversão da meta escolhida (compra ou lead). */
    conversion: conversionOf(x, src),
    /** Contagem da meta escolhida (compras ou leads). */
    goals: x[src.countMetric] ?? 0,
    purchases,
    transactions: x.transactions ?? 0,
    revenue: x.purchaseRevenue ?? 0,
    ticket: purchases ? (x.purchaseRevenue ?? 0) / purchases : 0,
    revenuePerUser: x.totalUsers ? (x.purchaseRevenue ?? 0) / x.totalUsers : 0,
  };
}
export type Cro = ReturnType<typeof cro>;

/** Lista de métricas do bloco CRO padrão, já ajustada ao que existe na propriedade e à meta. */
export async function croMetrics(ctx: QueryContext, extra: string[] = []) {
  const src = await conversionSource(ctx);
  const base = ["sessions", "totalUsers", "engagementRate", "ecommercePurchases", "transactions", "purchaseRevenue"];
  const goalMetrics = [src.rateMetric, src.countMetric].filter((m): m is string => !!m && !base.includes(m));
  return { metrics: [...base, ...goalMetrics, ...extra], src, derived: src.derived, terms: getTerms(src.goal) };
}

/** Relatório CRO padrão por uma dimensão, já com as derivadas calculadas. */
export async function croByDimension(
  ctx: QueryContext,
  dimension: string,
  opts: { limit?: number; extraMetrics?: string[] } = {},
) {
  const { metrics, src, terms } = await croMetrics(ctx, opts.extraMetrics);
  const report = await runReport(ctx, {
    dimensions: [dimension],
    metrics,
    orderBy: { metric: "sessions" },
    limit: opts.limit ?? 50,
    totals: true,
  });
  return {
    report,
    src,
    derived: src.derived,
    goal: src.goal,
    terms,
    total: { cur: cro(report.totals.cur, src), prev: report.totals.prev ? cro(report.totals.prev, src) : undefined },
    rows: report.rows.map((r: ReportRow) => ({
      row: r,
      value: r.dims[dimension],
      cur: cro(r.cur, src),
      prev: r.prev ? cro(r.prev, src) : undefined,
    })),
  };
}

/** Usuários que dispararam cada evento, por valor de uma dimensão (pivot dimensão x evento). */
export async function usersByEvent(ctx: QueryContext, dimension: string, events: string[], limit = 2000) {
  const report = await runReport(ctx, {
    dimensions: [dimension, "eventName"],
    metrics: ["totalUsers"],
    where: inList("eventName", events),
    compare: false,
    limit,
  });
  const out = new Map<string, Record<string, number>>();
  for (const r of report.rows) {
    const key = r.dims[dimension];
    const entry = out.get(key) ?? {};
    entry[r.dims.eventName] = r.cur.totalUsers ?? 0;
    out.set(key, entry);
  }
  return { map: out, meta: report.meta };
}

/** Inventário de eventos do período (nome, contagem, usuários, eventos-chave). */
export async function eventInventory(ctx: QueryContext, range = ctx.current) {
  const md = await getMetadata(ctx.propertyId);
  const metrics = ["eventCount", "totalUsers", ...(md.metrics.has("keyEvents") ? ["keyEvents"] : [])];
  const report = await runReport(ctx, {
    dimensions: ["eventName"],
    metrics,
    range,
    globalFilters: false,
    orderBy: { metric: "eventCount" },
    limit: 1000,
  });
  return report.rows.map((r) => ({
    event: r.dims.eventName,
    count: r.cur.eventCount ?? 0,
    users: r.cur.totalUsers ?? 0,
    keyEvents: r.cur.keyEvents ?? 0,
  }));
}

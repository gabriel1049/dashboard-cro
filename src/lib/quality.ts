import "server-only";

import type { Range } from "./state";
import { eq, inList, runReport, type QueryContext } from "./ga4/report";

const BLANK = new Set(["(not set)", ""]);

/** Saúde do purchase: transaction_id ausente, repetido e compras sem valor. */
export async function transactionQuality(ctx: QueryContext) {
  const report = await runReport(ctx, {
    dimensions: ["transactionId"],
    metrics: ["eventCount", "purchaseRevenue"],
    where: eq("eventName", "purchase"),
    compare: false,
    orderBy: { metric: "eventCount" },
    limit: 10_000,
  });
  let purchaseEvents = 0;
  let missingIdEvents = 0;
  let dupExtra = 0;
  let zeroRevenueIds = 0;
  const dups: { id: string; events: number; revenue: number }[] = [];
  const revenues: number[] = [];
  for (const r of report.rows) {
    const id = r.dims.transactionId;
    const events = r.cur.eventCount ?? 0;
    const revenue = r.cur.purchaseRevenue ?? 0;
    purchaseEvents += events;
    if (BLANK.has(id)) {
      missingIdEvents += events;
      continue;
    }
    if (events > 1) {
      dups.push({ id, events, revenue });
      dupExtra += events - 1;
    }
    if (revenue === 0) zeroRevenueIds++;
    else revenues.push(revenue / Math.max(events, 1));
  }
  revenues.sort((a, b) => a - b);
  const distinctIds = report.rows.filter((r) => !BLANK.has(r.dims.transactionId)).length;
  return {
    purchaseEvents,
    missingIdEvents,
    missingShare: purchaseEvents ? missingIdEvents / purchaseEvents : 0,
    distinctIds,
    dupIds: dups.length,
    dupExtra,
    topDups: dups.sort((a, b) => b.events - a.events).slice(0, 10),
    zeroRevenueIds,
    medianValue: revenues.length ? revenues[Math.floor(revenues.length / 2)] : 0,
    meta: report.meta,
  };
}
export type TransactionQuality = Awaited<ReturnType<typeof transactionQuality>>;

const UNATTRIBUTED = new Set(["Unassigned", "(not set)", ""]);

/** Parte das compras que um painel de CRO não consegue atribuir a canal/página/dispositivo. */
export const ATTRIBUTION_ALERT = 0.3;

/**
 * Compras sem origem: purchase que chega sem canal (Unassigned / not set). Acontece quando a compra
 * é enviada pelo servidor (Measurement Protocol) sem o client_id/session_id do navegador: o GA4
 * cria uma sessão nova, sem página, host, canal ou dispositivo, e o funil não liga o checkout à compra.
 */
export async function purchaseAttribution(ctx: QueryContext, range?: Range) {
  const report = await runReport(ctx, {
    dimensions: ["sessionDefaultChannelGroup"],
    metrics: ["eventCount"],
    where: eq("eventName", "purchase"),
    globalFilters: false,
    compare: false,
    range,
    limit: 100,
  });
  let total = 0;
  let unattributed = 0;
  for (const r of report.rows) {
    const n = r.cur.eventCount ?? 0;
    total += n;
    if (UNATTRIBUTED.has(r.dims.sessionDefaultChannelGroup)) unattributed += n;
  }
  return { total, unattributed, share: total ? unattributed / total : 0, meta: report.meta };
}
export type PurchaseAttribution = Awaited<ReturnType<typeof purchaseAttribution>>;

/** Diferença mínima na fatia de compras sem origem para considerar que a medição mudou entre os períodos. */
export const MEASUREMENT_SHIFT = 0.3;

const isoOf = (yyyymmdd: string) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;

/**
 * Mudança na forma de medir compras entre o período atual e o de comparação: a fatia de compras sem
 * origem muda muito (ex.: o purchase saiu do navegador e passou a ser enviado pelo servidor). Junto com
 * isso a compra costuma mudar de definição (antes na geração do boleto, depois no pagamento, por exemplo),
 * então a variação de compras, conversão e valor deixa de medir mudança de venda.
 * `since` é o primeiro dia a partir do qual a forma nova se mantém (null se não der para afirmar).
 */
export async function purchaseMeasurementShift(ctx: QueryContext) {
  if (!ctx.comparison) return null;
  const [cur, prev] = await Promise.all([purchaseAttribution(ctx, ctx.current), purchaseAttribution(ctx, ctx.comparison)]);
  if (cur.total < 20 || prev.total < 20 || Math.abs(cur.share - prev.share) < MEASUREMENT_SHIFT) return null;
  const since = await attributionChangeDate(ctx, cur.share > prev.share).catch(() => null);
  return { cur, prev, since };
}
export type MeasurementShift = NonNullable<Awaited<ReturnType<typeof purchaseMeasurementShift>>>;

/** Primeiro dia (com 3+ compras) a partir do qual todos os dias seguintes estão no regime novo. */
async function attributionChangeDate(ctx: QueryContext, toUnattributed: boolean): Promise<string | null> {
  const ranges = [ctx.current, ...(ctx.comparison ? [ctx.comparison] : [])];
  const start = ranges.map((r) => r.start).sort()[0];
  const end = ranges.map((r) => r.end).sort().at(-1)!;
  const report = await runReport(ctx, {
    dimensions: ["date", "sessionDefaultChannelGroup"],
    metrics: ["eventCount"],
    where: eq("eventName", "purchase"),
    globalFilters: false,
    compare: false,
    range: { start, end },
    limit: 50_000,
  });
  const days = new Map<string, { total: number; unattributed: number }>();
  for (const r of report.rows) {
    const d = days.get(r.dims.date) ?? { total: 0, unattributed: 0 };
    const n = r.cur.eventCount ?? 0;
    d.total += n;
    if (UNATTRIBUTED.has(r.dims.sessionDefaultChannelGroup)) d.unattributed += n;
    days.set(r.dims.date, d);
  }
  const sorted = [...days.entries()].filter(([, d]) => d.total >= 3).sort(([a], [b]) => a.localeCompare(b));
  let since: string | null = null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const [day, d] = sorted[i];
    const share = d.unattributed / d.total;
    if (toUnattributed ? share < ATTRIBUTION_ALERT : share >= ATTRIBUTION_ALERT) break;
    since = day;
  }
  // Se o regime novo cobre o intervalo inteiro, não houve virada dentro dele.
  return since && since !== sorted[0]?.[0] ? isoOf(since) : null;
}

/** Usuários que dispararam cada evento no período (sem exigir sequência). */
export async function eventUsers(ctx: QueryContext, events: string[]) {
  const report = await runReport(ctx, {
    dimensions: ["eventName"],
    metrics: ["totalUsers"],
    where: inList("eventName", events),
    compare: false,
  });
  return new Map(report.rows.map((r) => [r.dims.eventName, r.cur.totalUsers ?? 0]));
}

/**
 * Etapas "desconectadas": muita gente dispara o evento, mas quase ninguém chega nele vindo da etapa
 * anterior no funil fechado. Sinal de evento enviado sem vínculo com a navegação (servidor, outro
 * domínio sem cross-domain). Devolve os índices dessas etapas.
 */
export function disconnectedSteps(steps: { event: string; users: number }[], usersByEvent: Map<string, number>) {
  const out: number[] = [];
  steps.forEach((s, i) => {
    if (i === 0) return;
    const all = usersByEvent.get(s.event) ?? 0;
    if (all >= 50 && s.users < all * 0.2) out.push(i);
  });
  return out;
}

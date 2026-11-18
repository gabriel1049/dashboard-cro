import "server-only";

import { JOURNEY } from "@/config/cro";

import { CATEGORIES, classifyPage, isLandingPath, PAGE_TYPES, type Category, type PageType } from "../categories";
import { addDays, type Range } from "../state";
import { cached } from "./cache";
import type { FunnelStepDef } from "./funnel";
import { croMetrics, cro, leadAvailable, leadEvent } from "./kpis";
import { getMetadata } from "./metadata";
import { eq, not, runReport, type QueryContext, type Values } from "./report";

// ---------------------------------------------------------------------------
// Funil da jornada (evento macro + parâmetro de etapa)
// ---------------------------------------------------------------------------

const journeyDim = () => `customEvent:${JOURNEY.param}`;

/**
 * Etapas da jornada com volume nos últimos 90 dias, na ordem do simulador. null quando a
 * propriedade não tem o evento macro ou o parâmetro registrado como dimensão (ex.: app).
 */
export function journeySteps(ctx: QueryContext): Promise<FunnelStepDef[] | null> {
  return cached(`journey:${ctx.propertyId}:${ctx.today}`, 3 * 3600_000, async () => {
    const md = await getMetadata(ctx.propertyId);
    if (!md.dimensions.has(journeyDim())) return null;
    const r = await runReport(ctx, {
      dimensions: [journeyDim()],
      metrics: ["eventCount"],
      where: eq("eventName", JOURNEY.event),
      globalFilters: false,
      range: { start: addDays(ctx.today, -90), end: addDays(ctx.today, -1) },
      limit: 200,
    });
    const present = new Set(r.rows.filter((x) => x.cur.eventCount > 0).map((x) => x.dims[journeyDim()].toLowerCase()));
    const steps = JOURNEY.steps
      .filter((s) => present.has(s.value.toLowerCase()))
      .map((s) => ({ label: s.label, event: JOURNEY.event, param: { name: JOURNEY.param, value: s.value } }));
    return steps.length >= 2 ? steps : null;
  });
}

/**
 * Desde quando o evento macro chega todo dia (últimos 120 dias). Dia "falho" = menos de 20% da
 * mediana diária; devolve o dia seguinte à última falha, ou null se não houve falha (ou se a falha é
 * de ontem, que é queda recente e não começo de medição).
 */
export function journeyStableSince(ctx: QueryContext): Promise<string | null> {
  return cached(`journeysince:${ctx.propertyId}:${ctx.today}`, 3 * 3600_000, async () => {
    const range = { start: addDays(ctx.today, -120), end: addDays(ctx.today, -1) };
    const r = await runReport(ctx, {
      dimensions: ["date"],
      metrics: ["eventCount"],
      where: eq("eventName", JOURNEY.event),
      globalFilters: false,
      compare: false,
      range,
      limit: 200,
    });
    const byDate = new Map(r.rows.map((x) => [x.dims.date, x.cur.eventCount ?? 0]));
    const days: { date: string; n: number }[] = [];
    for (let d = range.start; d <= range.end; d = addDays(d, 1)) days.push({ date: d, n: byDate.get(d.replaceAll("-", "")) ?? 0 });
    const active = days.map((d) => d.n).filter((n) => n > 0).sort((a, b) => a - b);
    if (active.length < 7) return null;
    const floor = active[Math.floor(active.length / 2)] * 0.2;
    const lastGap = days.filter((d) => d.n < floor).at(-1);
    if (!lastGap || lastGap.date >= addDays(range.end, -1)) return null;
    return addDays(lastGap.date, 1);
  });
}

/** Usuários que viram cada tela de saída (ex.: "nenhum plano disponível") no período. */
export async function journeyExits(ctx: QueryContext) {
  const r = await runReport(ctx, {
    dimensions: [journeyDim()],
    metrics: ["totalUsers"],
    where: eq("eventName", JOURNEY.event),
    limit: 200,
  });
  return JOURNEY.exits.map((x) => {
    const row = r.rows.find((y) => y.dims[journeyDim()].toLowerCase() === x.value.toLowerCase());
    return { ...x, users: row?.cur.totalUsers ?? 0, prev: row?.prev?.totalUsers };
  });
}

// ---------------------------------------------------------------------------
// Perfil (idade e gênero x compras)
// ---------------------------------------------------------------------------

export const AGE_ORDER = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"];
export const GENDER_LABELS: Record<string, string> = { female: "Feminino", male: "Masculino" };

export type ProfileRow = {
  key: string;
  label: string;
  users: number;
  sessions: number;
  purchases: number;
  leads: number;
  /** Compras ÷ sessões. */
  purchaseRate: number;
  /** Sessões com lead ÷ sessões. */
  leadRate: number;
  shareUsers: number;
  sharePurchases: number;
  shareLeads: number;
  prev?: { users: number; purchases: number; leads: number };
};

export type ProfileReport = {
  rows: ProfileRow[];
  unknown: { users: number; purchases: number; leads: number };
  total: { users: number; purchases: number; leads: number; sessions: number };
  /** Parte das compras sem a faixa (compra enviada pelo servidor não traz dados demográficos). */
  unknownPurchaseShare: number;
  unknownUserShare: number;
  hasLead: boolean;
  thresholding: boolean;
};

/**
 * Faixa etária ou gênero cruzado com compras (e leads, quando o lead é evento-chave).
 * Os dados demográficos vêm do Google Signals: o GA4 aplica limite (thresholding) e muita
 * gente fica em "unknown". As participações são calculadas só entre quem tem a faixa.
 */
export async function profileReport(
  ctx: QueryContext,
  dimension: "userAgeBracket" | "userGender",
  opts: { range?: Range } = {},
): Promise<ProfileReport> {
  const hasLead = await leadAvailable(ctx.propertyId).catch(() => false);
  const ev = leadEvent();
  const metrics = ["totalUsers", "sessions", "ecommercePurchases", ...(hasLead ? [`keyEvents:${ev}`, `sessionKeyEventRate:${ev}`] : [])];
  const r = await runReport(ctx, {
    dimensions: [dimension],
    metrics,
    limit: 50,
    totals: true,
    range: opts.range,
    compare: opts.range ? false : undefined,
  });
  const val = (v: Values | undefined) => ({
    users: v?.totalUsers ?? 0,
    sessions: v?.sessions ?? 0,
    purchases: v?.ecommercePurchases ?? 0,
    leads: hasLead ? (v?.[`keyEvents:${ev}`] ?? 0) : 0,
    leadRate: hasLead ? (v?.[`sessionKeyEventRate:${ev}`] ?? 0) : 0,
  });
  const isUnknown = (k: string) => !k || k === "unknown" || k === "(not set)";
  const known = r.rows.filter((x) => !isUnknown(x.dims[dimension]));
  const unknownRows = r.rows.filter((x) => isUnknown(x.dims[dimension]));
  const sum = (rows: typeof r.rows, k: "users" | "purchases" | "leads") => rows.reduce((n, x) => n + val(x.cur)[k], 0);
  const kUsers = sum(known, "users");
  const kPurchases = sum(known, "purchases");
  const kLeads = sum(known, "leads");
  const order = (k: string) => (dimension === "userAgeBracket" ? AGE_ORDER.indexOf(k) : -val(known.find((x) => x.dims[dimension] === k)?.cur).users);
  const rows: ProfileRow[] = known
    .map((x) => {
      const key = x.dims[dimension];
      const c = val(x.cur);
      const p = x.prev ? val(x.prev) : undefined;
      return {
        key,
        label: dimension === "userGender" ? (GENDER_LABELS[key] ?? key) : key,
        users: c.users,
        sessions: c.sessions,
        purchases: c.purchases,
        leads: c.leads,
        purchaseRate: c.sessions ? c.purchases / c.sessions : 0,
        leadRate: c.leadRate,
        shareUsers: kUsers ? c.users / kUsers : 0,
        sharePurchases: kPurchases ? c.purchases / kPurchases : 0,
        shareLeads: kLeads ? c.leads / kLeads : 0,
        prev: p ? { users: p.users, purchases: p.purchases, leads: p.leads } : undefined,
      };
    })
    .sort((a, b) => order(a.key) - order(b.key));
  const total = val(r.totals.cur);
  const unknown = { users: sum(unknownRows, "users"), purchases: sum(unknownRows, "purchases"), leads: sum(unknownRows, "leads") };
  return {
    rows,
    unknown,
    total: { users: total.users, purchases: total.purchases, leads: total.leads, sessions: total.sessions },
    unknownPurchaseShare: total.purchases ? unknown.purchases / total.purchases : 0,
    unknownUserShare: total.users ? unknown.users / total.users : 0,
    hasLead,
    thresholding: r.meta.thresholding,
  };
}

/** Abaixo disso a fatia de compras por perfil é ruído (poucas compras chegam com idade e gênero). */
export const PROFILE_MIN_PURCHASES = 30;
/** Perfis com menos que isso do público não entram no destaque de "quem converte mais". */
export const PROFILE_MIN_SHARE = 0.05;

export type ProfileHighlights = {
  metric: "leads" | "compras";
  /** Fatia do perfil nos leads (ou nas compras). */
  share: (r: ProfileRow) => number;
  /** Fatia na conversão ÷ fatia no público: acima de 1, converte acima da média. */
  index: (r: ProfileRow) => number;
  /** Perfil que traz mais leads (ou compras) em volume. */
  top: ProfileRow;
  /** Perfil que mais converte (maior índice, entre os que têm público relevante). */
  best: ProfileRow;
};

/**
 * Os dois destaques de um perfil, sempre lidos juntos: quem traz mais conversões e quem converte
 * melhor. Mostrar só o segundo confunde (ex.: "18-24 converte mais" quando 25-34 traz 36% dos leads).
 */
export function profileHighlights(report: ProfileReport): ProfileHighlights | null {
  const knownPurchases = report.total.purchases - report.unknown.purchases;
  const metric = report.hasLead ? "leads" : knownPurchases >= PROFILE_MIN_PURCHASES ? "compras" : null;
  if (!metric) return null;
  const share = (r: ProfileRow) => (metric === "leads" ? r.shareLeads : r.sharePurchases);
  const index = (r: ProfileRow) => (r.shareUsers ? share(r) / r.shareUsers : 0);
  const top = [...report.rows].sort((a, b) => share(b) - share(a))[0];
  const best = report.rows.filter((r) => r.shareUsers >= PROFILE_MIN_SHARE).sort((a, b) => index(b) - index(a))[0];
  if (!top || !best || !share(top)) return null;
  return { metric, share, index, top, best };
}

/**
 * Último dia (até 400 dias atrás) em que as compras ainda chegavam com faixa etária. Depois da
 * mudança para o envio pelo servidor, a compra vem sem perfil; antes, dá para ler idade x compra.
 */
export function lastProfiledPurchaseDay(ctx: QueryContext): Promise<string | null> {
  return cached(`profiledbuy:${ctx.propertyId}:${ctx.today}`, 3 * 3600_000, async () => {
    const r = await runReport(ctx, {
      dimensions: ["date"],
      metrics: ["ecommercePurchases"],
      where: not(eq("userAgeBracket", "unknown")),
      globalFilters: false,
      compare: false,
      range: { start: addDays(ctx.today, -400), end: addDays(ctx.today, -1) },
      limit: 500,
    });
    const last = r.rows
      .filter((x) => (x.cur.ecommercePurchases ?? 0) >= 5)
      .map((x) => x.dims.date)
      .sort()
      .at(-1);
    return last ? `${last.slice(0, 4)}-${last.slice(4, 6)}-${last.slice(6, 8)}` : null;
  });
}

// ---------------------------------------------------------------------------
// Categoria de produto e tipo de página (a partir da página de entrada)
// ---------------------------------------------------------------------------

export type GroupAgg = {
  key: string;
  sessions: number;
  engaged: number;
  goals: number;
  purchases: number;
  /** Soma de taxa x sessões (taxa ponderada no fim). */
  rateWeight: number;
  pages: number;
  prevSessions: number;
  prevGoals: number;
  prevRateWeight: number;
  /** Sessões que chegaram a cada etapa da jornada (índice da etapa). */
  steps: number[];
};

export type CategoryReport = {
  byCategory: (GroupAgg & { key: Category })[];
  byType: (GroupAgg & { key: PageType })[];
  cross: Map<string, GroupAgg>;
  steps: FunnelStepDef[] | null;
  total: { sessions: number; goals: number; conversion: number };
  terms: Awaited<ReturnType<typeof croMetrics>>["terms"];
  hasPrev: boolean;
};

const emptyAgg = (key: string, nSteps: number): GroupAgg => ({
  key,
  sessions: 0,
  engaged: 0,
  goals: 0,
  purchases: 0,
  rateWeight: 0,
  pages: 0,
  prevSessions: 0,
  prevGoals: 0,
  prevRateWeight: 0,
  steps: new Array(nSteps).fill(0),
});

export const aggRate = (a: GroupAgg) => (a.sessions ? a.rateWeight / a.sessions : 0);
export const aggPrevRate = (a: GroupAgg) => (a.prevSessions ? a.prevRateWeight / a.prevSessions : 0);

/**
 * Sessões, conversão e etapas da jornada agregadas por categoria e por tipo de página.
 * Sessão tem uma página de entrada só, então as sessões somam sem contar ninguém duas vezes.
 * As etapas contam sessões que dispararam a etapa (não é funil fechado: serve para comparar categorias).
 */
export async function categoryReport(ctx: QueryContext): Promise<CategoryReport> {
  const { metrics, src, terms } = await croMetrics(ctx);
  const steps = await journeySteps(ctx).catch(() => null);
  const [pages, stepRows] = await Promise.all([
    runReport(ctx, { dimensions: ["landingPage"], metrics, orderBy: { metric: "sessions" }, limit: 3000, totals: true }),
    steps
      ? runReport(ctx, {
          dimensions: ["landingPage", journeyDim()],
          metrics: ["sessions"],
          where: eq("eventName", JOURNEY.event),
          compare: false,
          limit: 10000,
        })
      : null,
  ]);
  const n = steps?.length ?? 0;
  const cats = new Map<string, GroupAgg>();
  const types = new Map<string, GroupAgg>();
  const cross = new Map<string, GroupAgg>();
  const add = (m: Map<string, GroupAgg>, key: string) => {
    const a = m.get(key) ?? emptyAgg(key, n);
    m.set(key, a);
    return a;
  };
  for (const row of pages.rows) {
    const path = row.dims.landingPage;
    if (!isLandingPath(path)) continue;
    const { category, type } = classifyPage(path);
    const c = cro(row.cur, src);
    const p = row.prev ? cro(row.prev, src) : undefined;
    for (const a of [add(cats, category), add(types, type), add(cross, `${category}\u0001${type}`)]) {
      a.sessions += c.sessions;
      a.engaged += c.engagementRate * c.sessions;
      a.goals += c.goals;
      a.purchases += c.purchases;
      a.rateWeight += c.conversion * c.sessions;
      a.pages += 1;
      if (p) {
        a.prevSessions += p.sessions;
        a.prevGoals += p.goals;
        a.prevRateWeight += p.conversion * p.sessions;
      }
    }
  }
  if (steps && stepRows) {
    const idx = new Map(steps.map((s, i) => [s.param!.value.toLowerCase(), i]));
    for (const row of stepRows.rows) {
      const path = row.dims.landingPage;
      const i = idx.get((row.dims[journeyDim()] ?? "").toLowerCase());
      if (!isLandingPath(path) || i === undefined) continue;
      const { category, type } = classifyPage(path);
      for (const a of [add(cats, category), add(types, type), add(cross, `${category}\u0001${type}`)]) a.steps[i] += row.cur.sessions ?? 0;
    }
  }
  const totalCur = cro(pages.totals.cur, src);
  const order = <T extends string>(list: readonly T[]) => (a: GroupAgg, b: GroupAgg) =>
    list.indexOf(a.key as T) - list.indexOf(b.key as T);
  return {
    byCategory: [...cats.values()].sort(order(CATEGORIES)) as CategoryReport["byCategory"],
    byType: [...types.values()].sort(order(PAGE_TYPES)) as CategoryReport["byType"],
    cross,
    steps,
    total: { sessions: totalCur.sessions, goals: totalCur.goals, conversion: totalCur.conversion },
    terms,
    hasPrev: pages.hasComparison,
  };
}

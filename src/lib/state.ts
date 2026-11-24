/**
 * Estado do dashboard (período, comparação, filtros) guardado na URL.
 * Compartilhado entre servidor e cliente: um link sempre reabre a mesma visão.
 */

export type Preset =
  | "thisWeek"
  | "lastWeek"
  | "thisMonth"
  | "lastMonth"
  | "last7"
  | "last28"
  | "last30"
  | "last90"
  | "thisYear"
  | "custom";
export type CompareMode = "previous" | "yoy" | "none";
export type Range = { start: string; end: string };

export const PRESETS: { id: Preset; label: string }[] = [
  { id: "thisWeek", label: "Esta semana" },
  { id: "lastWeek", label: "Semana passada" },
  { id: "thisMonth", label: "Este mês" },
  { id: "lastMonth", label: "Mês passado" },
  { id: "last7", label: "Últimos 7 dias" },
  { id: "last28", label: "Últimos 28 dias" },
  { id: "last30", label: "Últimos 30 dias" },
  { id: "last90", label: "Últimos 90 dias" },
  { id: "thisYear", label: "Este ano" },
  { id: "custom", label: "Personalizado" },
];

/** Atalhos da barra de período: semana e mês comparam com a semana e o mês anteriores. */
export const QUICK_PRESETS: { id: Preset; label: string }[] = [
  { id: "thisWeek", label: "Semana" },
  { id: "thisMonth", label: "Mês" },
  { id: "last28", label: "28 dias" },
];

export const COMPARE_MODES: { id: CompareMode; label: string }[] = [
  { id: "previous", label: "Período anterior" },
  { id: "yoy", label: "Ano anterior" },
  { id: "none", label: "Sem comparação" },
];

export const FILTERS = [
  { key: "plataforma", dimension: "platform", label: "Plataforma" },
  { key: "dispositivo", dimension: "deviceCategory", label: "Dispositivo" },
  { key: "canal", dimension: "sessionDefaultChannelGroup", label: "Canal" },
  { key: "origem", dimension: "sessionSourceMedium", label: "Origem / mídia" },
  { key: "campanha", dimension: "sessionCampaignName", label: "Campanha" },
  { key: "pais", dimension: "country", label: "País" },
  { key: "regiao", dimension: "region", label: "Região" },
  { key: "versao", dimension: "appVersion", label: "Versão do app" },
] as const;

export type FilterKey = (typeof FILTERS)[number]["key"];

/** Meta de conversão analisada: lead (padrão, só em propriedades com o evento-chave de lead) ou compra. */
export type Goal = "compra" | "lead";

export const GOALS: { id: Goal; label: string }[] = [
  { id: "lead", label: "Lead" },
  { id: "compra", label: "Compra" },
];

export type DashboardState = {
  property?: string;
  preset: Preset;
  start?: string;
  end?: string;
  compare: CompareMode;
  goal: Goal;
  filters: Partial<Record<FilterKey, string[]>>;
};

export type SearchParams = Record<string, string | string[] | undefined>;

const DEFAULT_PRESET: Preset = "last28";
const DEFAULT_COMPARE: CompareMode = "previous";
/**
 * Lead é o padrão porque a maior parte das compras chega sem origem, página e perfil (envio pelo servidor),
 * o que zera a conversão em compra por campanha, página e categoria. Sem lead na propriedade, vira compra
 * (ver effectiveGoal).
 */
export const DEFAULT_GOAL: Goal = "lead";
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const many = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export function parseState(sp: SearchParams): DashboardState {
  const preset = PRESETS.some((p) => p.id === one(sp.periodo)) ? (one(sp.periodo) as Preset) : DEFAULT_PRESET;
  const compare = COMPARE_MODES.some((c) => c.id === one(sp.comparar))
    ? (one(sp.comparar) as CompareMode)
    : DEFAULT_COMPARE;
  const start = one(sp.de);
  const end = one(sp.ate);
  const filters: DashboardState["filters"] = {};
  for (const f of FILTERS) {
    const values = many(sp[f.key]).filter(Boolean);
    if (values.length) filters[f.key] = values;
  }
  return {
    property: one(sp.p),
    preset: preset === "custom" && !(start && end && ISO.test(start) && ISO.test(end)) ? DEFAULT_PRESET : preset,
    start: preset === "custom" ? start : undefined,
    end: preset === "custom" ? end : undefined,
    compare,
    goal: GOALS.some((g) => g.id === one(sp.meta)) ? (one(sp.meta) as Goal) : DEFAULT_GOAL,
    filters,
  };
}

/** Serializa o estado, omitindo valores padrão para a URL ficar curta. */
export function serializeState(state: DashboardState, extra?: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  if (state.property) q.set("p", state.property);
  if (state.preset !== DEFAULT_PRESET) q.set("periodo", state.preset);
  if (state.preset === "custom" && state.start && state.end) {
    q.set("de", state.start);
    q.set("ate", state.end);
  }
  if (state.compare !== DEFAULT_COMPARE) q.set("comparar", state.compare);
  if (state.goal !== DEFAULT_GOAL) q.set("meta", state.goal);
  for (const f of FILTERS) for (const v of state.filters[f.key] ?? []) q.append(f.key, v);
  for (const [k, v] of Object.entries(extra ?? {})) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function activeFilterCount(state: DashboardState): number {
  return FILTERS.reduce((n, f) => n + (state.filters[f.key]?.length ? 1 : 0), 0);
}

// ---------- datas ----------

export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dayCount(r: Range): number {
  return Math.round((Date.parse(`${r.end}T00:00:00Z`) - Date.parse(`${r.start}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Segunda-feira da semana da data (semana de segunda a domingo). */
function mondayOf(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = domingo
  return addDays(iso, -((day + 6) % 7));
}

/** Mesma faixa de dias no mês anterior (1 a 6 de nov -> 1 a 6 de out; 31 vira o último dia; mês inteiro -> mês inteiro). */
function previousMonthSpan(r: Range): Range {
  const [y, m] = r.start.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 2, 1));
  const lastDay = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  const ym = first.toISOString().slice(0, 7);
  // Mês inteiro (até o último dia) compara com o mês anterior inteiro.
  const [ey, em, ed] = r.end.split("-").map(Number);
  if (r.start.endsWith("-01") && ed === new Date(Date.UTC(ey, em, 0)).getUTCDate()) {
    return { start: `${ym}-01`, end: `${ym}-${String(lastDay).padStart(2, "0")}` };
  }
  const day = (iso: string) => Math.min(Number(iso.slice(8, 10)), lastDay);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { start: `${ym}-${pad(day(r.start))}`, end: `${ym}-${pad(day(r.end))}` };
}

/** Granularidade da comparação "anterior": semana e mês comparam com a semana e o mês anteriores. */
export function periodUnit(preset: Preset): "week" | "month" | "days" {
  if (preset === "thisWeek" || preset === "lastWeek") return "week";
  if (preset === "thisMonth" || preset === "lastMonth") return "month";
  return "days";
}

/** Nome do período de comparação, para frases ("vs semana anterior"). */
export function compareLabel(state: Pick<DashboardState, "preset" | "compare">): string {
  if (state.compare === "yoy") return "ano anterior";
  if (state.compare === "none") return "sem comparação";
  const unit = periodUnit(state.preset);
  return unit === "week" ? "semana anterior" : unit === "month" ? "mês anterior" : "período anterior";
}

/** O mesmo nome com artigo, para frases ("contra a semana anterior", "contra o mês anterior"). */
export function compareWith(state: Pick<DashboardState, "preset" | "compare">): string {
  const label = compareLabel(state);
  return `${label.startsWith("semana") ? "a" : "o"} ${label}`;
}

function shiftYear(iso: string, years: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y + years, m - 1, d));
  // 29/02 em ano não bissexto vira 28/02
  if (target.getUTCMonth() !== m - 1) target.setUTCDate(0);
  return target.toISOString().slice(0, 10);
}

export function resolveRanges(state: DashboardState, today: string): { current: Range; comparison?: Range } {
  const yesterday = addDays(today, -1);
  const [yy, ym] = yesterday.split("-");
  const [ty, tm] = today.split("-").map(Number);
  let current: Range;
  switch (state.preset) {
    // Semana e mês correntes contam até ontem; numa segunda (ou no dia 1) viram a semana (ou o mês) que acabou.
    case "thisWeek":
      current = { start: mondayOf(yesterday), end: yesterday };
      break;
    case "lastWeek": {
      const start = addDays(mondayOf(today), -7);
      current = { start, end: addDays(start, 6) };
      break;
    }
    case "last7":
      current = { start: addDays(yesterday, -6), end: yesterday };
      break;
    case "last30":
      current = { start: addDays(yesterday, -29), end: yesterday };
      break;
    case "last90":
      current = { start: addDays(yesterday, -89), end: yesterday };
      break;
    case "thisMonth":
      current = { start: `${yy}-${ym}-01`, end: yesterday };
      break;
    case "lastMonth": {
      const firstThis = new Date(Date.UTC(ty, tm - 1, 1));
      const lastPrev = new Date(firstThis.getTime() - 86_400_000);
      const firstPrev = new Date(Date.UTC(lastPrev.getUTCFullYear(), lastPrev.getUTCMonth(), 1));
      current = { start: firstPrev.toISOString().slice(0, 10), end: lastPrev.toISOString().slice(0, 10) };
      break;
    }
    case "thisYear":
      current = { start: `${yy}-01-01`, end: yesterday };
      break;
    case "custom": {
      const start = state.start! <= state.end! ? state.start! : state.end!;
      const end = state.start! <= state.end! ? state.end! : state.start!;
      current = { start, end: end > today ? today : end };
      break;
    }
    default:
      current = { start: addDays(yesterday, -27), end: yesterday };
  }

  if (state.compare === "none") return { current };
  if (state.compare === "yoy") {
    return { current, comparison: { start: shiftYear(current.start, -1), end: shiftYear(current.end, -1) } };
  }
  const unit = periodUnit(state.preset);
  if (unit === "week") return { current, comparison: { start: addDays(current.start, -7), end: addDays(current.end, -7) } };
  if (unit === "month") return { current, comparison: previousMonthSpan(current) };
  const end = addDays(current.start, -1);
  return { current, comparison: { start: addDays(end, -(dayCount(current) - 1)), end } };
}

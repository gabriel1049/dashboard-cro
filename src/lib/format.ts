/** Formatação pt-BR para números, moeda, percentuais e datas. */

const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const dec = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brlCompact = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Tipo de formatação de uma coluna, cartão ou série. "pct" espera proporção (0,123), não percentual. */
export type FormatKind = "int" | "decimal" | "pct" | "brl" | "duration";

// null, undefined, NaN e Infinity viram null, que as funções abaixo mostram como traço.
const safe = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? null : n);

/** Inteiro com separador de milhar ("12.345"). */
export function fmtInt(n: number | null | undefined) {
  const v = safe(n);
  return v === null ? "–" : int.format(v);
}

/** Abaixo de 10 mil mostra o número inteiro; acima, abreviado ("12,3 mil"). */
export function fmtCompact(n: number | null | undefined) {
  const v = safe(n);
  if (v === null) return "–";
  return Math.abs(v) < 10_000 ? int.format(v) : compact.format(v);
}

/** Número com até duas casas decimais. */
export function fmtDecimal(n: number | null | undefined) {
  const v = safe(n);
  return v === null ? "–" : dec.format(v);
}

/** Recebe uma proporção (0,123) e devolve "12,3%". */
export function fmtPct(n: number | null | undefined, digits?: number) {
  const v = safe(n);
  if (v === null) return "–";
  // Abaixo de 1% ganha uma casa a mais, para taxas pequenas não ficarem todas iguais.
  const d = digits ?? (Math.abs(v) < 0.01 ? 2 : 1);
  return `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d })}%`;
}

/** Reais sem centavos. Com compact, a partir de 100 mil fica abreviado ("R$ 1,2 mi"). */
export function fmtBRL(n: number | null | undefined, opts?: { compact?: boolean }) {
  const v = safe(n);
  if (v === null) return "–";
  return opts?.compact && Math.abs(v) >= 100_000 ? brlCompact.format(v) : brl.format(v);
}

/** Segundos como "3min 05s" (ou só "42s" abaixo de um minuto). */
export function fmtDuration(seconds: number | null | undefined) {
  const v = safe(seconds);
  if (v === null) return "–";
  const m = Math.floor(v / 60);
  const s = Math.round(v % 60);
  return m ? `${m}min ${s.toString().padStart(2, "0")}s` : `${s}s`;
}

/** Formata pelo FormatKind. compact só afeta inteiros e moeda (ex.: eixos dos gráficos). */
export function formatValue(n: number | null | undefined, kind: FormatKind, opts?: { compact?: boolean }) {
  switch (kind) {
    case "pct":
      return fmtPct(n);
    case "brl":
      return fmtBRL(n, opts);
    case "decimal":
      return fmtDecimal(n);
    case "duration":
      return fmtDuration(n);
    default:
      return opts?.compact ? fmtCompact(n) : fmtInt(n);
  }
}

/** Variação relativa (cur vs prev). null quando não há base de comparação. */
export function relChange(cur: number, prev: number | undefined | null): number | null {
  if (prev === undefined || prev === null || !Number.isFinite(prev) || prev === 0) return null;
  return (cur - prev) / Math.abs(prev);
}

/** Variação com sinal ("+12,3%"). O negativo usa o sinal de menos tipográfico (U+2212), não o hífen. */
export function fmtSignedPct(n: number | null) {
  if (n === null || !Number.isFinite(n)) return "–";
  const s = fmtPct(Math.abs(n));
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : s;
}

/** Diferença entre duas taxas em pontos percentuais. */
export function fmtPP(diff: number | null) {
  if (diff === null || !Number.isFinite(diff)) return "–";
  const v = (Math.abs(diff) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  return `${diff > 0 ? "+" : diff < 0 ? "−" : ""}${v} p.p.`;
}

const dShort = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", timeZone: "UTC" });
const dLong = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const toDate = (iso: string) => new Date(`${iso.length === 8 ? `${iso.slice(0, 4)}-${iso.slice(4, 6)}-${iso.slice(6)}` : iso}T00:00:00Z`);

/** Dia curto, sem ano ("6 de out"). Aceita AAAA-MM-DD ou AAAAMMDD, o formato do GA4. */
export function fmtDay(iso: string) {
  return dShort.format(toDate(iso)).replace(".", "");
}

/** Período com o ano no fim; o início só leva o ano quando cai em outro ano. */
export function fmtRange(r: { start: string; end: string }) {
  const sameYear = r.start.slice(0, 4) === r.end.slice(0, 4);
  return `${sameYear ? fmtDay(r.start) : dLong.format(toDate(r.start)).replace(".", "")} – ${dLong
    .format(toDate(r.end))
    .replace(".", "")}`;
}

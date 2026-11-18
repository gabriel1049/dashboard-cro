import "server-only";

import { protos } from "@google-analytics/data";

import { addDays, type Goal, type Range } from "../state";
import { cached } from "./cache";
import { betaClient } from "./client";
import { toGa4Error } from "./errors";
import { assertFields } from "./metadata";

type FilterExpression = protos.google.analytics.data.v1beta.IFilterExpression;
type RunReportResponse = protos.google.analytics.data.v1beta.IRunReportResponse;

/**
 * Consulta padrão ao GA4 (runReport): valida os nomes no metadata, aplica os filtros globais,
 * traz o período de comparação na mesma chamada e devolve as linhas já pareadas (cur e prev).
 */

/** Filtro da barra: uma dimensão e os valores aceitos. */
export type GlobalFilter = { dimension: string; values: string[] };

/** Contexto comum a todas as consultas de uma página, montado a partir da URL em buildContext. */
export type QueryContext = {
  propertyId: string;
  current: Range;
  comparison?: Range;
  filters: GlobalFilter[];
  today: string;
  /** Meta pedida na URL; vira "compra" quando a propriedade não tem o evento-chave de lead (ver goalSource). */
  goal: Goal;
};

/** O que um bloco pede ao GA4. */
export type ReportSpec = {
  dimensions?: string[];
  metrics: string[];
  /** Filtro extra do bloco (ex.: eventName em [...]), somado aos filtros globais. */
  where?: FilterExpression;
  /** false = ignora os filtros globais (ex.: listas de opções dos filtros). */
  globalFilters?: boolean;
  orderBy?: { metric?: string; dimension?: string; desc?: boolean };
  limit?: number;
  /** false = não traz o período de comparação. */
  compare?: boolean;
  totals?: boolean;
  /** Período fixo para este bloco (sem comparação). */
  range?: Range;
};

export type Values = Record<string, number>;
/** Linha pareada: key junta os valores das dimensões; cur e prev são os dois períodos. */
export type ReportRow = { key: string; dims: Record<string, string>; cur: Values; prev?: Values };
/** Limites do GA4 que afetam os números (o MetaNotice mostra os avisos). */
export type ReportMeta = { thresholding: boolean; otherRow: boolean; sampled: boolean; restricted: string[] };
export type ReportResult = {
  rows: ReportRow[];
  totals: { cur: Values; prev?: Values };
  meta: ReportMeta;
  rowCount: number;
  hasComparison: boolean;
};

// ---------- construtores de filtro ----------

/** Dimensão igual a qualquer um dos valores. */
export function inList(dimension: string, values: string[]): FilterExpression {
  return { filter: { fieldName: dimension, inListFilter: { values } } };
}

/** Dimensão igual a um valor (correspondência exata). */
export function eq(dimension: string, value: string): FilterExpression {
  return { filter: { fieldName: dimension, stringFilter: { value, matchType: "EXACT" } } };
}

/** Negação de um filtro. */
export function not(expr: FilterExpression): FilterExpression {
  return { notExpression: expr };
}

/** Junta filtros com E e ignora os undefined; sem nenhum, devolve undefined (consulta sem filtro). */
export function and(...exprs: (FilterExpression | undefined)[]): FilterExpression | undefined {
  const list = exprs.filter(Boolean) as FilterExpression[];
  if (!list.length) return undefined;
  return list.length === 1 ? list[0] : { andGroup: { expressions: list } };
}

/** Filtros da barra: E entre as dimensões, OU entre os valores de cada uma. */
export function globalFilterExpression(filters: GlobalFilter[]): FilterExpression | undefined {
  return and(...filters.map((f) => inList(f.dimension, f.values)));
}

// ---------- consulta ----------

const zero = (metrics: string[]): Values => Object.fromEntries(metrics.map((m) => [m, 0]));

function ttlFor(range: Range, today: string) {
  // Dados recentes ainda são processados pelo GA4: cache curto. Períodos fechados: cache longo.
  return range.end >= addDays(today, -2) ? 20 * 60_000 : 6 * 3600_000;
}

/** runReport com cache. Com comparação, os dois períodos vêm na mesma chamada e saem pareados por linha. */
export async function runReport(ctx: QueryContext, spec: ReportSpec): Promise<ReportResult> {
  const dims = spec.dimensions ?? [];
  await assertFields(
    ctx.propertyId,
    [...dims, ...(spec.globalFilters === false ? [] : ctx.filters.map((f) => f.dimension))],
    spec.metrics,
  );

  const current = spec.range ?? ctx.current;
  const compare = spec.compare !== false && !spec.range && Boolean(ctx.comparison);
  // Com dois períodos o GA4 acrescenta a dimensão dateRange, com o nome dado aqui (cur ou prev).
  const dateRanges = [{ startDate: current.start, endDate: current.end, name: "cur" }];
  if (compare) dateRanges.push({ startDate: ctx.comparison!.start, endDate: ctx.comparison!.end, name: "prev" });

  const limit = spec.limit ?? 10_000;
  const request: protos.google.analytics.data.v1beta.IRunReportRequest = {
    property: `properties/${ctx.propertyId}`,
    dateRanges,
    dimensions: dims.map((name) => ({ name })),
    metrics: spec.metrics.map((name) => ({ name })),
    dimensionFilter: and(spec.globalFilters === false ? undefined : globalFilterExpression(ctx.filters), spec.where),
    orderBys: spec.orderBy
      ? [
          spec.orderBy.metric
            ? { metric: { metricName: spec.orderBy.metric }, desc: spec.orderBy.desc ?? true }
            : { dimension: { dimensionName: spec.orderBy.dimension }, desc: spec.orderBy.desc ?? false },
        ]
      : undefined,
    // Cada combinação de dimensões pode vir uma vez por período, então o limite dobra com comparação.
    limit: limit * (compare ? 2 : 1),
    metricAggregations: spec.totals ? [protos.google.analytics.data.v1beta.MetricAggregation.TOTAL] : undefined,
  };

  // A chave é a própria requisição: blocos que pedem a mesma coisa dividem uma chamada.
  const res = await cached(JSON.stringify(request), ttlFor(current, ctx.today), async () => {
    try {
      const [r] = await betaClient().runReport(request);
      return r;
    } catch (err) {
      throw toGa4Error(err);
    }
  });

  return parseReport(res, dims, spec, compare, limit);
}

/** Junta as linhas dos dois períodos pela combinação de dimensões e lê os avisos do metadata da resposta. */
function parseReport(
  res: RunReportResponse,
  dims: string[],
  spec: ReportSpec,
  compare: boolean,
  limit: number,
): ReportResult {
  const dHeaders = (res.dimensionHeaders ?? []).map((h) => h.name ?? "");
  const mHeaders = (res.metricHeaders ?? []).map((h) => h.name ?? "");
  const rangeIdx = dHeaders.indexOf("dateRange");
  const dimIdx = dims.map((d) => dHeaders.indexOf(d));

  const toValues = (vals: { value?: string | null }[] | null | undefined): Values =>
    Object.fromEntries(mHeaders.map((m, i) => [m, Number(vals?.[i]?.value ?? 0)]));
  const whichRange = (dv: string[]) => (rangeIdx >= 0 && dv[rangeIdx] === "prev" ? "prev" : "cur");

  const byKey = new Map<string, ReportRow>();
  let otherRow = Boolean(res.metadata?.dataLossFromOtherRow);

  for (const row of res.rows ?? []) {
    const dv = (row.dimensionValues ?? []).map((v) => v.value ?? "");
    const dimValues = dimIdx.map((i) => (i >= 0 ? dv[i] : ""));
    // Nem sempre o GA4 marca dataLossFromOtherRow; uma linha "(other)" no resultado também conta.
    if (dimValues.includes("(other)")) otherRow = true;
    // \u0001 não aparece em valores do GA4, então a chave não colide entre combinações.
    const key = dimValues.join("\u0001");
    const entry =
      byKey.get(key) ??
      ({ key, dims: Object.fromEntries(dims.map((d, i) => [d, dimValues[i]])), cur: zero(spec.metrics) } as ReportRow);
    if (whichRange(dv) === "prev") entry.prev = toValues(row.metricValues);
    else entry.cur = toValues(row.metricValues);
    byKey.set(key, entry);
  }

  let rows = [...byKey.values()];
  // Linha sem par na comparação conta como zero lá. A ordem do GA4 mistura os dois períodos,
  // então a ordenação por métrica é refeita pelo período atual antes de cortar no limite.
  if (compare) for (const r of rows) r.prev ??= zero(spec.metrics);
  if (spec.orderBy?.metric) {
    const m = spec.orderBy.metric;
    const dir = spec.orderBy.desc === false ? 1 : -1;
    rows.sort((a, b) => dir * ((a.cur[m] ?? 0) - (b.cur[m] ?? 0)));
  }
  rows = rows.slice(0, limit);

  const totals: ReportResult["totals"] = { cur: zero(spec.metrics), prev: compare ? zero(spec.metrics) : undefined };
  for (const t of res.totals ?? []) {
    const dv = (t.dimensionValues ?? []).map((v) => v.value ?? "");
    totals[whichRange(dv)] = toValues(t.metricValues);
  }

  const md = res.metadata;
  return {
    rows,
    totals,
    rowCount: Number(res.rowCount ?? rows.length),
    hasComparison: compare,
    meta: {
      thresholding: Boolean(md?.subjectToThresholding),
      otherRow,
      sampled: Boolean(md?.samplingMetadatas?.length),
      restricted: (md?.schemaRestrictionResponse?.activeMetricRestrictions ?? []).map((r) => r.metricName ?? ""),
    },
  };
}

/** Resultado ou mensagem de erro, para cada bloco do painel falhar sozinho sem derrubar a página. */
export type Settled<T> = { ok: true; data: T } | { ok: false; error: string };

/** Espera a Promise de um bloco e devolve Settled, já com a mensagem de erro traduzida. */
export async function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, data: await p };
  } catch (err) {
    return { ok: false, error: toGa4Error(err).message };
  }
}

/** Junta os avisos de várias consultas que alimentam o mesmo bloco. */
export function mergeMeta(...metas: (ReportMeta | undefined)[]): ReportMeta {
  const list = metas.filter(Boolean) as ReportMeta[];
  return {
    thresholding: list.some((m) => m.thresholding),
    otherRow: list.some((m) => m.otherRow),
    sampled: list.some((m) => m.sampled),
    restricted: [...new Set(list.flatMap((m) => m.restricted))],
  };
}

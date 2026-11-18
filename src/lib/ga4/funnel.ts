import "server-only";

import type { protos } from "@google-analytics/data";

import type { Range } from "../state";
import { cached } from "./cache";
import { alphaClient } from "./client";
import { toGa4Error } from "./errors";
import { assertFields } from "./metadata";
import { and, globalFilterExpression, inList, runReport, type QueryContext } from "./report";

/**
 * Funil de conversão pelo runFunnelReport (v1alpha), fechado e com quebra opcional por uma dimensão.
 * Se a API alpha falhar, cai num plano B com usuários por evento, que não garante a sequência.
 */

/** Etapa: um evento, opcionalmente com um valor de parâmetro (evento macro, ex.: etapa_simulacao + nome_etapa). */
export type FunnelStepDef = { label: string; event: string; param?: { name: string; value: string } };

/** Chave única da etapa (evento sozinho ou evento + valor do parâmetro). */
export const stepKey = (d: FunnelStepDef) => (d.param ? `${d.event}|${d.param.value}` : d.event);

export type FunnelStep = {
  label: string;
  event: string;
  /** Chave única (evento ou evento + valor do parâmetro). */
  key: string;
  /** Valor do parâmetro da etapa, quando a etapa vem do evento macro. */
  detail?: string;
  users: number;
  /** Proporção que segue para a próxima etapa (null na última). */
  nextRate: number | null;
  /** Proporção que abandona antes da próxima etapa (null na última). */
  dropRate: number | null;
  /** Proporção em relação à primeira etapa. */
  fromStart: number;
};

/** Etapas de um segmento da quebra, ou do total. */
export type FunnelSeries = { segment: string; steps: FunnelStep[] };

export type FunnelResult = {
  /** funnel = runFunnelReport (sequencial, fechado); fallback = usuários por evento (não sequencial). */
  method: "funnel" | "fallback";
  total: FunnelSeries;
  segments: FunnelSeries[];
  fallbackReason?: string;
};

/** Calcula as taxas de passagem e de abandono a partir dos usuários em cada etapa. */
function buildSeries(segment: string, defs: FunnelStepDef[], users: number[]): FunnelSeries {
  const first = users[0] || 0;
  return {
    segment,
    steps: defs.map((d, i) => {
      const next = i < defs.length - 1 ? users[i + 1] : null;
      const nextRate = next === null ? null : users[i] ? next / users[i] : 0;
      return {
        label: d.label,
        event: d.event,
        key: stepKey(d),
        detail: d.param?.value,
        users: users[i] ?? 0,
        nextRate,
        dropRate: nextRate === null ? null : 1 - nextRate,
        fromStart: first ? (users[i] ?? 0) / first : 0,
      };
    }),
  };
}

// Valor que o runFunnelReport põe na dimensão da quebra para a linha de total. Sem quebra, tudo cai aqui.
const TOTAL = "RESERVED_TOTAL";

/** Funil fechado pelo runFunnelReport. Qualquer erro da API alpha vai para o plano B, com o motivo em fallbackReason. */
export async function runFunnel(
  ctx: QueryContext,
  defs: FunnelStepDef[],
  opts: {
    breakdown?: string;
    /** Quantos valores da quebra o GA4 devolve (os demais somem do resultado). */
    breakdownLimit?: number;
    range?: Range;
    where?: protos.google.analytics.data.v1beta.IFilterExpression;
  } = {},
): Promise<FunnelResult> {
  const range = opts.range ?? ctx.current;
  await assertFields(ctx.propertyId, [...ctx.filters.map((f) => f.dimension), ...(opts.breakdown ? [opts.breakdown] : [])], []);

  const request: protos.google.analytics.data.v1alpha.IRunFunnelReportRequest = {
    property: `properties/${ctx.propertyId}`,
    dateRanges: [{ startDate: range.start, endDate: range.end }],
    funnel: {
      // Fechado: só conta numa etapa quem passou pelas anteriores.
      isOpenFunnel: false,
      steps: defs.map((d) => ({
        name: d.label,
        filterExpression: {
          funnelEventFilter: {
            eventName: d.event,
            funnelParameterFilterExpression: d.param
              ? {
                  funnelParameterFilter: {
                    eventParameterName: d.param.name,
                    // Sem diferenciar maiúsculas, igual à comparação do plano B.
                    stringFilter: { value: d.param.value, matchType: "EXACT", caseSensitive: false },
                  },
                }
              : undefined,
          },
        },
      })),
    },
    funnelBreakdown: opts.breakdown ? { breakdownDimension: { name: opts.breakdown }, limit: opts.breakdownLimit ?? 6 } : undefined,
    // O filtro do v1beta tem o mesmo formato no v1alpha; o cast só acerta o tipo.
    dimensionFilter: and(globalFilterExpression(ctx.filters), opts.where) as protos.google.analytics.data.v1alpha.IFilterExpression,
  };

  try {
    const res = await cached(`funnel:${JSON.stringify(request)}`, 30 * 60_000, async () => {
      try {
        const [r] = await alphaClient().runFunnelReport(request);
        return r;
      } catch (err) {
        throw toGa4Error(err);
      }
    });
    const table = res.funnelTable;
    const dHeaders = (table?.dimensionHeaders ?? []).map((h) => h.name ?? "");
    const mHeaders = (table?.metricHeaders ?? []).map((h) => h.name ?? "");
    const stepIdx = dHeaders.indexOf("funnelStepName");
    const segIdx = opts.breakdown ? dHeaders.indexOf(opts.breakdown) : -1;
    // Do funnelTable só interessa activeUsers; as taxas são recalculadas em buildSeries.
    const usersIdx = mHeaders.indexOf("activeUsers");

    const bySegment = new Map<string, number[]>();
    for (const row of table?.rows ?? []) {
      const dv = (row.dimensionValues ?? []).map((v) => v.value ?? "");
      const step = Number.parseInt(dv[stepIdx] ?? "", 10) - 1; // "1. Ver plano" -> 0
      if (!(step >= 0 && step < defs.length)) continue;
      const seg = segIdx >= 0 ? dv[segIdx] : TOTAL;
      const arr = bySegment.get(seg) ?? new Array(defs.length).fill(0);
      arr[step] = Number(row.metricValues?.[usersIdx]?.value ?? 0);
      bySegment.set(seg, arr);
    }

    const totalUsers = bySegment.get(TOTAL) ?? new Array(defs.length).fill(0);
    const segments = [...bySegment.entries()]
      .filter(([seg]) => seg !== TOTAL)
      .map(([seg, users]) => buildSeries(seg, defs, users))
      .sort((a, b) => b.steps[0].users - a.steps[0].users);
    return { method: "funnel", total: buildSeries("Total", defs, totalUsers), segments };
  } catch (err) {
    return runFallback(ctx, defs, range, opts.breakdown, toGa4Error(err).message, opts.where, opts.breakdownLimit ?? 6);
  }
}

/** Plano B: usuários que dispararam cada evento no período (não garante a sequência). */
async function runFallback(
  ctx: QueryContext,
  defs: FunnelStepDef[],
  range: Range,
  breakdown: string | undefined,
  reason: string,
  where?: protos.google.analytics.data.v1beta.IFilterExpression,
  limit = 6,
): Promise<FunnelResult> {
  // Etapas com parâmetro: o valor do parâmetro entra como dimensão (customEvent:<parâmetro>).
  const paramDims = [...new Set(defs.filter((d) => d.param).map((d) => `customEvent:${d.param!.name}`))];
  const report = await runReport(ctx, {
    dimensions: ["eventName", ...paramDims, ...(breakdown ? [breakdown] : [])],
    metrics: ["totalUsers"],
    where: and(inList("eventName", [...new Set(defs.map((d) => d.event))]), where),
    range,
    totals: false,
  });
  const matches = (d: FunnelStepDef, dims: Record<string, string>) =>
    dims.eventName === d.event && (!d.param || (dims[`customEvent:${d.param.name}`] ?? "").toLowerCase() === d.param.value.toLowerCase());
  const usersFor = (seg?: string) =>
    defs.map((d) =>
      report.rows
        .filter((r) => matches(d, r.dims) && (seg === undefined || r.dims[breakdown!] === seg))
        .reduce((n, r) => n + (r.cur.totalUsers ?? 0), 0),
    );
  const segValues = breakdown ? [...new Set(report.rows.map((r) => r.dims[breakdown]))] : [];
  return {
    method: "fallback",
    fallbackReason: reason,
    total: buildSeries("Total", defs, usersFor()),
    segments: segValues
      .map((seg) => buildSeries(seg, defs, usersFor(seg)))
      .sort((a, b) => b.steps[0].users - a.steps[0].users)
      // Mesmo corte de segmentos que o funnelBreakdown faria.
      .slice(0, limit),
  };
}

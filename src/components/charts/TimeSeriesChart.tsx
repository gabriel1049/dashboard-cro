"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";

import { fmtDay, formatValue, type FormatKind } from "@/lib/format";

import { axisStyle, baseOption, EChart, tooltipRows, useChartTheme } from "./EChart";

/** Um dia da série: data AAAAMMDD (como o GA4 devolve) e os valores por métrica. */
export type SeriesPoint = { date: string; values: Record<string, number> };
export type SeriesMetric = {
  key: string;
  label: string;
  format: FormatKind;
  /** Taxa: ao agrupar por semana ou mês vira média ponderada por esta métrica (ex.: sessões). */
  weight?: string;
  /** false = não soma entre dias (ex.: usuários); some da lista na semana e no mês. */
  additive?: boolean;
};

type Grain = "day" | "week" | "month";
// Semana só a partir de 14 dias e mês a partir de 45, para o gráfico não ficar com um ou dois pontos.
const GRAINS: { id: Grain; label: string; minDays: number }[] = [
  { id: "day", label: "Dia", minDays: 0 },
  { id: "week", label: "Semana", minDays: 14 },
  { id: "month", label: "Mês", minDays: 45 },
];

/** Início do grupo (segunda-feira da semana ou dia 1 do mês), no formato AAAAMMDD. */
function bucketOf(date: string, g: Grain) {
  if (g === "day") return date;
  if (g === "month") return `${date.slice(0, 6)}01`;
  const d = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00:00Z`);
  // getUTCDay() conta a partir do domingo; (dia + 6) % 7 dá quantos dias se passaram desde a segunda.
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10).replaceAll("-", "");
}

const MONTH = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" });
/** Rótulo do eixo e da tabela: "out/25" no mês, "sem. 6 de out" na semana, "6 de out" no dia. */
function labelOf(date: string, g: Grain) {
  if (g === "month") return MONTH.format(new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-15T00:00:00Z`)).replace(". de ", "/");
  return g === "week" ? `sem. ${fmtDay(date)}` : fmtDay(date);
}

/** Agrupa os dias por semana ou mês: contagens somam, taxas viram média ponderada. */
function aggregate(points: SeriesPoint[], metrics: SeriesMetric[], g: Grain): SeriesPoint[] {
  if (g === "day") return points;
  const out = new Map<string, { sums: Record<string, number>; weights: Record<string, number> }>();
  for (const p of points) {
    const key = bucketOf(p.date, g);
    const b = out.get(key) ?? { sums: {}, weights: {} };
    for (const m of metrics) {
      const v = p.values[m.key] ?? 0;
      if (m.weight) {
        const w = p.values[m.weight] ?? 0;
        b.sums[m.key] = (b.sums[m.key] ?? 0) + v * w;
        b.weights[m.key] = (b.weights[m.key] ?? 0) + w;
      } else b.sums[m.key] = (b.sums[m.key] ?? 0) + v;
    }
    out.set(key, b);
  }
  return [...out.entries()].map(([date, b]) => ({
    date,
    values: Object.fromEntries(
      metrics.map((m) => [m.key, m.weight ? (b.weights[m.key] ? b.sums[m.key] / b.weights[m.key] : 0) : (b.sums[m.key] ?? 0)]),
    ),
  }));
}

/**
 * Evolução de uma métrica por vez (um eixo só), por dia, semana ou mês, com o período de comparação
 * tracejado, alinhado pela posição. Alterna entre gráfico e tabela.
 */
export function TimeSeriesChart({
  points: rawPoints,
  prevPoints: rawPrev,
  metrics,
  currentLabel,
  prevLabel,
}: {
  points: SeriesPoint[];
  prevPoints?: SeriesPoint[];
  metrics: SeriesMetric[];
  currentLabel: string;
  prevLabel?: string;
}) {
  const [metricKey, setMetricKey] = useState(metrics[0]?.key);
  const [view, setView] = useState<"chart" | "table">("chart");
  const [grain, setGrain] = useState<Grain>("day");
  const t = useChartTheme();
  const grains = GRAINS.filter((g) => rawPoints.length >= g.minDays);
  const shown = grain === "day" ? metrics : metrics.filter((m) => m.additive !== false);
  const metric = shown.find((m) => m.key === metricKey) ?? shown[0];
  const points = useMemo(() => aggregate(rawPoints, metrics, grain), [rawPoints, metrics, grain]);
  const prevPoints = useMemo(() => (rawPrev ? aggregate(rawPrev, metrics, grain) : undefined), [rawPrev, metrics, grain]);
  const unit = grain === "day" ? "Dia" : grain === "week" ? "Semana" : "Mês";

  const option = useMemo(() => {
    if (!t || !metric) return null;
    const cur = points.map((p) => p.values[metric.key] ?? 0);
    const prev = prevPoints?.map((p) => p.values[metric.key] ?? 0);
    const ax = axisStyle(t);
    return {
      ...baseOption(t),
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
      xAxis: {
        type: "category",
        data: points.map((p) => labelOf(p.date, grain)),
        boundaryGap: false,
        ...ax,
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        ...ax,
        axisLine: { show: false },
        axisLabel: { ...ax.axisLabel, formatter: (v: number) => formatValue(v, metric.format, { compact: true }) },
      },
      tooltip: {
        ...(baseOption(t).tooltip as object),
        trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: t.axis, width: 1 } },
        formatter: (params: { dataIndex: number }[]) => {
          const i = params[0]?.dataIndex ?? 0;
          const rows: { color: string; label: string; value: string; dashed?: boolean }[] = [
            { color: t.accent, label: labelOf(points[i].date, grain), value: formatValue(cur[i], metric.format) },
          ];
          if (prev && prevPoints?.[i]) {
            rows.push({ color: t.compare, label: labelOf(prevPoints[i].date, grain), value: formatValue(prev[i], metric.format), dashed: true });
          }
          return tooltipRows(metric.label, rows);
        },
      },
      series: [
        ...(prev
          ? [
              {
                name: prevLabel ?? "Comparação",
                type: "line",
                data: prev,
                symbol: "none",
                lineStyle: { width: 2, color: t.compare, type: "dashed" },
                itemStyle: { color: t.compare },
                z: 1,
              },
            ]
          : []),
        {
          name: currentLabel,
          type: "line",
          data: cur,
          symbol: "circle",
          symbolSize: 10,
          // Marcadores só com poucos pontos; em séries longas eles poluem a linha.
          showSymbol: points.length <= 16,
          lineStyle: { width: 3, color: t.accent, cap: "round", join: "round" },
          itemStyle: { color: t.accent, borderColor: t.surface, borderWidth: 2 },
          areaStyle: { color: t.accent, opacity: 0.12 },
          z: 2,
        },
      ],
    };
  }, [t, metric, points, prevPoints, currentLabel, prevLabel, grain]);

  return (
    <div>
      <div className="no-export mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-rule">
        <div role="tablist" aria-label="Métrica" className="-mb-px flex flex-wrap gap-x-5">
          {shown.map((m) => (
            <button
              key={m.key}
              type="button"
              role="tab"
              aria-selected={m.key === metric?.key}
              onClick={() => setMetricKey(m.key)}
              className={clsx(
                "h-9 border-b-2 text-sm transition-colors",
                m.key === metric?.key ? "border-accent font-semibold text-ink" : "border-transparent text-ink-2 hover:text-ink",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="mb-1.5 flex items-center gap-2">
          {grains.length > 1 && (
            <div role="group" aria-label="Agrupar por" className="flex h-8 items-center gap-0.5 rounded-full bg-raised p-0.5">
              {grains.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={grain === g.id}
                  onClick={() => setGrain(g.id)}
                  className={clsx(
                    "h-7 rounded-full px-3 text-[0.8125rem] transition-colors",
                    grain === g.id ? "bg-primary font-semibold text-primary-ink" : "text-ink-2 hover:text-ink",
                  )}
                >
                  {g.label}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setView(view === "chart" ? "table" : "chart")}
            className="h-8 rounded-full px-3 text-sm text-ink-2 hover:bg-raised hover:text-ink"
          >
            {view === "chart" ? "Ver tabela" : "Ver gráfico"}
          </button>
        </div>
      </div>

      {view === "chart" ? (
        <>
          <EChart option={option} height="clamp(260px, 17vw, 420px)" ariaLabel={`${metric?.label} por ${unit.toLowerCase()}`} />
          <div className="mt-3 flex flex-wrap gap-5 text-xs text-ink-2">
            <LegendKey color="var(--accent)" label={currentLabel} />
            {prevPoints && <LegendKey color="var(--compare)" dashed label={prevLabel ?? "Comparação"} />}
          </div>
        </>
      ) : (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-sm tabular">
            <thead className="sticky top-0 bg-surface text-left text-xs text-muted">
              <tr>
                <th className="py-1.5 font-medium">{unit}</th>
                <th className="py-1.5 text-right font-medium">{metric?.label}</th>
                {prevPoints && <th className="py-1.5 text-right font-medium">Comparação</th>}
              </tr>
            </thead>
            <tbody>
              {points.map((p, i) => (
                <tr key={p.date} className="border-t border-rule">
                  <td className="py-1.5 text-ink-2">{labelOf(p.date, grain)}</td>
                  <td className="py-1.5 text-right text-ink">{formatValue(p.values[metric!.key], metric!.format)}</td>
                  {prevPoints && (
                    <td className="py-1.5 text-right text-ink-2">
                      {prevPoints[i] ? formatValue(prevPoints[i].values[metric!.key], metric!.format) : "–"}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Item de legenda em HTML, fora do gráfico: linha (sólida ou tracejada), quadrado ou ponto na cor da série. */
export function LegendKey({
  color,
  label,
  shape = "line",
  dashed,
}: {
  color: string;
  label: string;
  shape?: "line" | "rect" | "dot";
  dashed?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        style={
          shape === "line"
            ? { width: 16, height: 0, borderTop: `2px ${dashed ? "dashed" : "solid"} ${color}` }
            : { width: shape === "dot" ? 10 : 11, height: shape === "dot" ? 10 : 11, borderRadius: shape === "dot" ? 999 : 3, background: color }
        }
      />
      {label}
    </span>
  );
}

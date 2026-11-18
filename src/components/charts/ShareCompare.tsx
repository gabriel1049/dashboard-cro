"use client";

import { useMemo } from "react";

import { formatValue, type FormatKind } from "@/lib/format";

import { axisStyle, baseOption, EChart, tooltipRows, useChartTheme, type ChartTheme } from "./EChart";
import { LegendKey } from "./TimeSeriesChart";

export type CompareSeries = {
  label: string;
  /** Token da cor: accent (série principal), highlight (destaque) ou compare (referência, cinza). */
  color: "accent" | "highlight" | "compare" | "series3";
  values: number[];
};

const cssVar: Record<CompareSeries["color"], string> = {
  accent: "var(--accent)",
  highlight: "var(--highlight)",
  compare: "var(--compare)",
  series3: "var(--series-3)",
};
const themeColor = (t: ChartTheme, c: CompareSeries["color"]) =>
  c === "accent" ? t.accent : c === "highlight" ? t.highlight : c === "series3" ? t.series3 : t.compare;

/**
 * Barras horizontais agrupadas por categoria (ex.: faixa etária), uma barra por série, com o valor
 * escrito na ponta. Serve para comparar participações: quando a barra da conversão passa a do
 * público, aquele perfil converte acima da média.
 */
export function ShareCompare({
  categories,
  series,
  format = "pct",
  ariaLabel,
  note,
}: {
  categories: string[];
  series: CompareSeries[];
  format?: FormatKind;
  ariaLabel: string;
  note?: string;
}) {
  const t = useChartTheme();
  const option = useMemo(() => {
    if (!t) return null;
    const ax = axisStyle(t);
    // O eixo de categorias do ECharts desenha de baixo para cima: inverte para a primeira ficar no topo.
    const cats = [...categories].reverse();
    const max = Math.max(...series.flatMap((s) => s.values), 1e-9);
    return {
      ...baseOption(t),
      grid: { left: 8, right: 56, top: 4, bottom: 4, containLabel: true },
      xAxis: { type: "value", max: max * 1.12, show: false },
      yAxis: {
        type: "category",
        data: cats,
        ...ax,
        axisLine: { show: false },
        splitLine: { show: false },
        axisLabel: { color: t.ink, fontSize: t.fs + 1, fontWeight: 500, margin: 14 },
      },
      tooltip: {
        ...(baseOption(t).tooltip as object),
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: t.grid, opacity: 0.6 } },
        formatter: (params: { dataIndex: number }[]) => {
          const i = params[0]?.dataIndex ?? 0;
          const ci = categories.length - 1 - i;
          return tooltipRows(
            categories[ci],
            series.map((s) => ({ color: themeColor(t, s.color), label: s.label, value: formatValue(s.values[ci], format) })),
          );
        },
      },
      series: series.map((s) => ({
        name: s.label,
        type: "bar",
        data: [...s.values].reverse(),
        barMaxWidth: 14,
        barGap: "25%",
        itemStyle: { color: themeColor(t, s.color), borderRadius: [0, 4, 4, 0] },
        label: {
          show: true,
          position: "right",
          distance: 6,
          color: t.ink2,
          fontSize: t.fs - 1,
          formatter: (p: { value: number }) => formatValue(p.value, format),
        },
      })),
    };
  }, [t, categories, series, format]);

  const rowHeight = series.length * 18 + 22;
  return (
    <div>
      <EChart option={option} height={categories.length * rowHeight + 16} ariaLabel={ariaLabel} />
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-2">
        {series.map((s) => (
          <LegendKey key={s.label} shape="rect" color={cssVar[s.color]} label={s.label} />
        ))}
        {note && <span className="text-muted">{note}</span>}
      </div>
    </div>
  );
}

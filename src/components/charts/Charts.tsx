"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useDashboardNav } from "@/components/shell/PendingProvider";
import { useStateHref } from "@/components/shell/useStateHref";
import { fmtDay, formatValue, type FormatKind } from "@/lib/format";
import type { FilterKey } from "@/lib/state";

import { axisStyle, baseOption, EChart, tooltipRows, useChartTheme, type ChartInstance } from "./EChart";
import { LegendKey } from "./TimeSeriesChart";

// ---------------------------------------------------------------------------
// Matriz de oportunidade: volume (x) contra uma taxa (y), com a média e o corte de volume.
// As maiores oportunidades viram círculos numerados (quanto maior, mais se ganha levando o
// item à média) e a lista ao lado diz quem é cada número; passar o mouse num acende o outro.
// Itens abaixo do corte de volume ficam em cinza: a taxa deles é de amostra pequena.
// ---------------------------------------------------------------------------

export type ScatterPoint = {
  name: string;
  x: number;
  y: number;
  flagged?: boolean;
  /** Tamanho da oportunidade (ex.: leads que faltam para a média): ordena e dimensiona os numerados. */
  weight?: number;
};

type RankedPoint = ScatterPoint & { rank: number; size: number };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** "/" sozinho some no gráfico; escrito como página inicial fica claro. */
const display = (name: string) => (name === "/" ? "/ (página inicial)" : name);

export function OpportunityMatrix({
  points,
  xLabel,
  yLabel,
  xFormat,
  yFormat,
  xRef,
  yRef,
  minX,
  weightLabel,
  weightFormat = "decimal",
  weightUnit,
  labelCount = 8,
  zoneLabel,
  itemLabel = "item",
  flaggedLabel = "Precisa de atenção",
  otherLabel = "Demais",
  rankTitle,
  rankNote,
  height = "clamp(360px, 26vw, 600px)",
}: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  xFormat: FormatKind;
  yFormat: FormatKind;
  /** Corte de volume (linha vertical). Abaixo dele os pontos ficam em cinza. */
  xRef?: number;
  /** Média da taxa (linha horizontal). */
  yRef?: number;
  /** Itens com volume abaixo disso ficam fora do gráfico (amostra pequena distorce a taxa). */
  minX?: number;
  weightLabel?: string;
  weightFormat?: FormatKind;
  /** Unidade curta do peso na lista ("leads", "compras"). */
  weightUnit?: string;
  /** Quantos destacados ganham número no gráfico e linha na lista. */
  labelCount?: number;
  /** Texto da zona de oportunidade (volume acima do corte, taxa abaixo da média). */
  zoneLabel?: string;
  /** Como chamar cada ponto na nota de rodapé ("página", "aparelho"). */
  itemLabel?: string;
  flaggedLabel?: string;
  otherLabel?: string;
  /** Título da lista numerada (padrão: o rótulo dos destacados). */
  rankTitle?: string;
  /** Como a lista está ordenada, em uma frase. */
  rankNote?: string;
  height?: number | string;
}) {
  const t = useChartTheme();
  const chartRef = useRef<ChartInstance | null>(null);
  const [active, setActive] = useState<string | null>(null);

  const valid = useMemo(() => points.filter((p) => p.x > 0 && (minX === undefined || p.x >= minX)), [points, minX]);
  const hidden = points.filter((p) => p.x > 0).length - valid.length;
  const xs = valid.map((p) => p.x);
  const useLog = xs.length > 2 && Math.max(...xs) / Math.max(Math.min(...xs), 1) > 100;
  // Fim do eixo um pouco além do maior ponto, para o rótulo dele caber; a zona vai até ali.
  const xMax = xs.length ? Math.max(...xs) * (useLog ? 1.8 : 1.08) : undefined;
  const isLow = (p: ScatterPoint) => !p.flagged && xRef !== undefined && p.x < xRef;
  const lowCount = valid.filter(isLow).length;

  // Numerados: os destacados com mais a ganhar (ou com mais volume, quando não há peso).
  const ranked: RankedPoint[] = useMemo(() => {
    const score = (p: ScatterPoint) => p.weight ?? p.x;
    const top = valid
      .filter((p) => p.flagged)
      .sort((a, b) => score(b) - score(a))
      .slice(0, labelCount);
    const max = Math.max(...top.map(score), 1e-9);
    return top.map((p, i) => ({ ...p, rank: i + 1, size: Math.sqrt(score(p) / max) }));
  }, [valid, labelCount]);
  // Ordem de desenho: maiores atrás, para nenhum círculo pequeno sumir embaixo de um grande.
  const rankedDraw = useMemo(() => [...ranked].sort((a, b) => b.size - a.size), [ranked]);

  const option = useMemo(() => {
    if (!t) return null;
    const ax = axisStyle(t);
    const k = t.fs / 13; // tamanhos crescem com a fonte da página (monitores grandes)
    const bubble = (r: RankedPoint) => Math.round((20 + 22 * r.size) * k);
    const rankedSet = new Set(ranked.map((r) => r.name));
    const xMin = Math.min(...xs) * 0.8;
    // Posição relativa no eixo x (0 a 1): perto da borda direita o nome vai para a esquerda.
    const along = (x: number) =>
      useLog ? Math.log(x / xMin) / Math.log((xMax ?? x) / xMin) : (x - xMin) / ((xMax ?? x) - xMin);
    const plain = (list: ScatterPoint[]) => list.map((p) => ({ name: p.name, value: [p.x, p.y], weight: p.weight }));

    const low = valid.filter(isLow);
    const others = valid.filter((p) => !p.flagged && !isLow(p));
    const flaggedRest = valid.filter((p) => p.flagged && !rankedSet.has(p.name));

    // Nomes escritos no gráfico: os 3 primeiros da lista e as 3 páginas de mais volume fora dela.
    const named = [
      ...ranked.slice(0, 3).map((r) => ({ p: r as ScatterPoint, gap: bubble(r) / 2 + 6 })),
      ...[...others].sort((a, b) => b.x - a.x).slice(0, 3).map((p) => ({ p, gap: 11 * k })),
    ];

    const refLines = [
      ...(yRef !== undefined
        ? [{ yAxis: yRef, label: { formatter: `Média ${formatValue(yRef, yFormat)}`, position: "insideEndTop" } }]
        : []),
      ...(xRef !== undefined
        ? [{ xAxis: xRef, label: { formatter: `${formatValue(xRef, xFormat)} ${xLabel.toLowerCase()}`, position: "end" } }]
        : []),
    ];
    const halo = { textBorderColor: t.surface, textBorderWidth: 3 };

    return {
      ...baseOption(t),
      grid: { left: 8, right: 24, top: Math.round(30 * k), bottom: 8, containLabel: true },
      xAxis: {
        type: useLog ? "log" : "value",
        ...ax,
        axisLine: { ...ax.axisLine, onZero: false },
        min: useLog ? (v: { min: number }) => Math.max(v.min * 0.8, 1) : undefined,
        max: xMax,
        splitLine: { show: false },
        axisLabel: {
          ...ax.axisLabel,
          showMinLabel: !useLog,
          showMaxLabel: false,
          formatter: (v: number) => formatValue(v, xFormat, { compact: true }),
        },
      },
      yAxis: {
        type: "value",
        // Folga abaixo do zero: os círculos de taxa 0 não ficam cortados pela borda.
        min: (v: { max: number }) => -(v.max || 1) * 0.06,
        ...ax,
        axisLine: { show: false },
        axisLabel: {
          ...ax.axisLabel,
          formatter: (v: number) => (v < 0 ? "" : v === 0 && yFormat === "pct" ? "0%" : formatValue(v, yFormat)),
        },
      },
      tooltip: {
        ...(baseOption(t).tooltip as object),
        trigger: "item",
        confine: true,
        formatter: (p: {
          data: { name: string; value: [number, number]; weight?: number; rank?: number };
          color: string;
        }) =>
          tooltipRows(`${p.data.rank ? `${p.data.rank}. ` : ""}${clip(display(p.data.name), 70)}`, [
            { color: p.color, label: yLabel, value: formatValue(p.data.value[1], yFormat) },
            { color: "transparent", label: xLabel, value: formatValue(p.data.value[0], xFormat) },
            ...(weightLabel && p.data.weight
              ? [{ color: "transparent", label: weightLabel, value: formatValue(p.data.weight, weightFormat) }]
              : []),
          ]),
      },
      series: [
        {
          id: "low",
          name: "Pouco tráfego",
          type: "scatter",
          data: plain(low),
          symbolSize: Math.round(8 * k),
          itemStyle: { color: t.muted, opacity: 0.45 },
          emphasis: { scale: 1.5 },
          z: 1,
        },
        {
          id: "others",
          name: otherLabel,
          type: "scatter",
          data: plain(others),
          symbolSize: Math.round(11 * k),
          itemStyle: { color: t.accent, opacity: 0.85, borderColor: t.surface, borderWidth: 1.5 },
          emphasis: { scale: 1.4 },
          markArea:
            xRef !== undefined && yRef !== undefined
              ? {
                  silent: true,
                  itemStyle: { color: t.highlight, opacity: 0.1 },
                  label: {
                    show: Boolean(zoneLabel),
                    formatter: zoneLabel ?? "",
                    position: "insideTopLeft",
                    distance: 8,
                    color: t.ink2,
                    fontSize: t.fs,
                    ...halo,
                  },
                  data: [[{ xAxis: xRef, yAxis: 0 }, { xAxis: xMax, yAxis: yRef }]],
                }
              : undefined,
          markLine: refLines.length
            ? {
                silent: true,
                symbol: "none",
                label: { color: t.ink2, fontSize: t.fs, ...halo },
                lineStyle: { color: t.muted, type: "dashed", width: 1.5, opacity: 0.9 },
                data: refLines,
              }
            : undefined,
          z: 2,
        },
        {
          id: "flagged",
          name: flaggedLabel,
          type: "scatter",
          data: plain(flaggedRest),
          symbolSize: Math.round(12 * k),
          itemStyle: { color: t.highlight, opacity: 0.85, borderColor: t.surface, borderWidth: 1.5 },
          emphasis: { scale: 1.4 },
          z: 3,
        },
        {
          id: "ranked",
          name: flaggedLabel,
          type: "scatter",
          clip: false,
          data: rankedDraw.map((r) => ({
            name: r.name,
            value: [r.x, r.y],
            weight: r.weight,
            rank: r.rank,
            symbolSize: bubble(r),
          })),
          itemStyle: { color: t.highlight, borderColor: t.surface, borderWidth: 2 },
          label: {
            show: true,
            position: "inside",
            formatter: (p: { data: { rank: number } }) => String(p.data.rank),
            color: t.surface,
            fontSize: t.fs,
            fontWeight: 700,
          },
          emphasis: { scale: 1.15, itemStyle: { borderColor: t.ink } },
          z: 4,
        },
        {
          id: "names",
          type: "scatter",
          silent: true,
          tooltip: { show: false },
          symbolSize: 0,
          data: named.map(({ p, gap }) => ({
            name: p.name,
            value: [p.x, p.y],
            label: { position: along(p.x) > 0.78 ? "left" : "right", distance: gap },
          })),
          label: {
            show: true,
            color: t.ink,
            fontSize: t.fs,
            fontWeight: 500,
            formatter: (p: { name: string }) => clip(display(p.name), 28),
            ...halo,
          },
          labelLayout: { hideOverlap: true },
          z: 5,
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, valid, ranked, rankedDraw, useLog, xMax, xLabel, yLabel, xFormat, yFormat, xRef, yRef, weightLabel, weightFormat, zoneLabel, flaggedLabel, otherLabel]);

  // Círculo sob o mouse acende a linha da lista.
  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    const over = (p: { seriesId?: string; data?: unknown }) => {
      const d = p.data as { name?: string } | undefined;
      if (p.seriesId === "ranked" && d?.name) setActive(d.name);
    };
    const out = (p: { seriesId?: string }) => {
      if (p.seriesId === "ranked") setActive(null);
    };
    c.on("mouseover", over);
    c.on("mouseout", out);
    return () => {
      c.off("mouseover", over);
      c.off("mouseout", out);
    };
  }, [option]);

  // Linha da lista sob o mouse acende o círculo e abre o tooltip dele.
  const focus = (name: string | null) => {
    setActive(name);
    const c = chartRef.current;
    if (!c) return;
    c.dispatchAction({ type: "downplay", seriesId: "ranked" });
    c.dispatchAction({ type: "hideTip" });
    const i = name ? rankedDraw.findIndex((r) => r.name === name) : -1;
    if (i >= 0) {
      c.dispatchAction({ type: "highlight", seriesId: "ranked", dataIndex: i });
      c.dispatchAction({ type: "showTip", seriesId: "ranked", dataIndex: i });
    }
  };

  // Poucos itens (ex.: dispositivos): pontos soltos num plano grande quase não aparecem; barras mostram melhor.
  if (valid.length > 0 && valid.length <= 8) {
    return (
      <RateBars
        points={valid}
        xLabel={xLabel}
        yLabel={yLabel}
        xFormat={xFormat}
        yFormat={yFormat}
        yRef={yRef}
        flaggedLabel={flaggedLabel}
        otherLabel={otherLabel}
      />
    );
  }

  const fmtWeight = (w: number) => formatValue(w, w < 10 ? "decimal" : "int");

  return (
    <div>
      <div
        className={
          ranked.length
            ? "grid gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_19rem] min-[112.5rem]:grid-cols-[minmax(0,1fr)_23rem]"
            : undefined
        }
      >
        <div className="min-w-0">
          <div className="mb-1 text-xs text-muted">↑ {yLabel}</div>
          <EChart option={option} height={height} ariaLabel={`${yLabel} por ${xLabel}`} instanceRef={chartRef} />
          <div className="mt-1 text-right text-xs text-muted">
            {xLabel}
            {useLog ? " (escala log)" : ""} →
          </div>
        </div>
        {ranked.length > 0 && (
          <div className="min-w-0 border-line max-lg:border-t max-lg:pt-5 lg:border-l lg:pl-8">
            <p className="text-sm font-semibold text-ink">{rankTitle ?? flaggedLabel}</p>
            {rankNote && <p className="mt-1 text-xs leading-relaxed text-muted">{rankNote}</p>}
            <ol className="mt-3">
              {ranked.map((r) => (
                <li
                  key={r.name}
                  onMouseEnter={() => focus(r.name)}
                  onMouseLeave={() => focus(null)}
                  className={`-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors ${
                    active === r.name ? "bg-active" : ""
                  }`}
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-highlight text-xs font-bold text-surface tabular-nums">
                    {r.rank}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink" title={r.name}>
                      {display(r.name)}
                    </span>
                    <span className="block truncate text-xs text-muted tabular-nums">
                      {formatValue(r.x, xFormat, { compact: true })} {xLabel.toLowerCase()} · {formatValue(r.y, yFormat)}
                      {yRef !== undefined ? ` (média ${formatValue(yRef, yFormat)})` : ""}
                    </span>
                  </span>
                  {r.weight !== undefined && (
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-semibold text-ink tabular-nums">+{fmtWeight(r.weight)}</span>
                      {weightUnit && <span className="block text-xs text-muted">{weightUnit}</span>}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-2">
        <LegendKey shape="dot" color="var(--highlight)" label={ranked.some((r) => r.weight !== undefined) ? `${flaggedLabel} (maior = mais a ganhar)` : flaggedLabel} />
        <LegendKey shape="dot" color="var(--accent)" label={otherLabel} />
        {lowCount > 0 && xRef !== undefined && (
          <LegendKey
            shape="dot"
            color="color-mix(in srgb, var(--muted) 55%, transparent)"
            label={`Pouco tráfego (menos de ${formatValue(xRef, xFormat)} ${xLabel.toLowerCase()}): taxa instável`}
          />
        )}
        {(xRef !== undefined || yRef !== undefined) && (
          <LegendKey color="var(--muted)" dashed label={xRef !== undefined ? "Média e corte de volume" : "Média do período"} />
        )}
        {hidden > 0 && minX !== undefined && (
          <span className="text-muted">
            {hidden} {hidden === 1 ? itemLabel : `${itemLabel}s`} com menos de {formatValue(minX, xFormat)} {xLabel.toLowerCase()}{" "}
            fora do gráfico
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Taxa por categoria em barras horizontais: a forma da matriz quando há poucos itens
// (ex.: 3 ou 4 dispositivos), em que pontos soltos num plano grande quase não aparecem.
// Barra = taxa; ao lado, a taxa escrita e o volume. Linha tracejada = média.
// ---------------------------------------------------------------------------

export function RateBars({
  points,
  xLabel,
  yLabel,
  xFormat,
  yFormat,
  yRef,
  flaggedLabel,
  otherLabel,
}: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  xFormat: FormatKind;
  yFormat: FormatKind;
  yRef?: number;
  flaggedLabel: string;
  otherLabel: string;
}) {
  const t = useChartTheme();
  // Mais volume no topo (o eixo de categorias do ECharts desenha de baixo para cima).
  const rows = useMemo(() => [...points].sort((a, b) => a.x - b.x), [points]);

  const option = useMemo(() => {
    if (!t) return null;
    const ax = axisStyle(t);
    const maxY = Math.max(...rows.map((r) => r.y), yRef ?? 0);
    return {
      ...baseOption(t),
      grid: { left: 8, right: 8, top: 28, bottom: 8, containLabel: true },
      xAxis: {
        type: "value",
        max: maxY > 0 ? maxY * 1.35 : 1,
        ...ax,
        axisLine: { show: false },
        axisLabel: { ...ax.axisLabel, showMaxLabel: false, formatter: (v: number) => formatValue(v, yFormat) },
      },
      yAxis: {
        type: "category",
        data: rows.map((r) => r.name),
        ...ax,
        splitLine: { show: false },
        axisLabel: { color: t.ink, fontSize: t.fs + 2, fontWeight: 500, margin: 14 },
      },
      tooltip: {
        ...(baseOption(t).tooltip as object),
        trigger: "item",
        confine: true,
        formatter: (p: { dataIndex: number; color: string }) => {
          const r = rows[p.dataIndex];
          return tooltipRows(r.name, [
            { color: p.color, label: yLabel, value: formatValue(r.y, yFormat) },
            { color: "transparent", label: xLabel, value: formatValue(r.x, xFormat) },
          ]);
        },
      },
      series: [
        {
          type: "bar",
          barMaxWidth: 30,
          barMinHeight: 3,
          data: rows.map((r) => ({
            value: r.y,
            itemStyle: { color: r.flagged ? t.highlight : t.accent, borderRadius: [0, 4, 4, 0] },
          })),
          label: {
            show: true,
            position: "right",
            distance: 10,
            formatter: (p: { dataIndex: number }) => {
              const r = rows[p.dataIndex];
              return `{v|${formatValue(r.y, yFormat)}}  {s|${formatValue(r.x, xFormat, { compact: true })} ${xLabel.toLowerCase()}}`;
            },
            rich: {
              v: { color: t.ink, fontSize: t.fs + 3, fontWeight: 600, fontFamily: t.font },
              s: { color: t.muted, fontSize: t.fs, fontFamily: t.font },
            },
          },
          markLine:
            yRef !== undefined
              ? {
                  silent: true,
                  symbol: "none",
                  lineStyle: { color: t.muted, type: "dashed", width: 1.5 },
                  label: {
                    position: "end",
                    formatter: `Média ${formatValue(yRef, yFormat)}`,
                    color: t.ink2,
                    fontSize: t.fs,
                  },
                  data: [{ xAxis: yRef }],
                }
              : undefined,
        },
      ],
    };
  }, [t, rows, xLabel, yLabel, xFormat, yFormat, yRef]);

  return (
    <div>
      <EChart option={option} height={rows.length * 64 + 56} ariaLabel={`${yLabel} por categoria`} />
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-2">
        {rows.some((r) => r.flagged) && <LegendKey shape="rect" color="var(--highlight)" label={flaggedLabel} />}
        <LegendKey shape="rect" color="var(--accent)" label={otherLabel} />
        {yRef !== undefined && <LegendKey color="var(--muted)" dashed label="Média do período" />}
        <span className="text-muted">Barra: {yLabel.toLowerCase()} · ao lado, o volume de {xLabel.toLowerCase()}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Barras horizontais comparando participação (ex.: % das sessões x % das compras).
// ---------------------------------------------------------------------------

export function ShareBars({
  categories,
  a,
  b,
  filterKey,
  height,
}: {
  categories: string[];
  a: { label: string; values: number[] };
  b: { label: string; values: number[] };
  filterKey?: FilterKey;
  height?: number;
}) {
  const t = useChartTheme();
  const { state, hrefFor } = useStateHref();
  const { navigate } = useDashboardNav();

  const option = useMemo(() => {
    if (!t) return null;
    const ax = axisStyle(t);
    const cats = [...categories].reverse();
    const rev = (v: number[]) => [...v].reverse();
    // Valor escrito no fim de cada barra (texto em tinta, nunca na cor da série).
    const valueLabel = {
      show: true,
      position: "right" as const,
      distance: 6,
      color: t.ink2,
      fontSize: t.fs - 1,
      formatter: (p: { value: number }) => (p.value >= 0.005 ? formatValue(p.value, "pct") : ""),
    };
    return {
      ...baseOption(t),
      grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: "value",
        ...ax,
        axisLabel: { ...ax.axisLabel, formatter: (v: number) => formatValue(v, "pct") },
      },
      yAxis: {
        type: "category",
        data: cats,
        ...ax,
        splitLine: { show: false },
        axisLabel: { color: t.ink, fontSize: t.fs + 1, fontWeight: 500, margin: 12 },
      },
      tooltip: {
        ...(baseOption(t).tooltip as object),
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: t.grid, opacity: 0.4 } },
        formatter: (params: { dataIndex: number; name: string }[]) => {
          const i = params[0].dataIndex;
          return tooltipRows(params[0].name, [
            { color: t.accent, label: a.label, value: formatValue(rev(a.values)[i], "pct") },
            { color: t.series2, label: b.label, value: formatValue(rev(b.values)[i], "pct") },
          ]);
        },
      },
      series: [
        {
          name: a.label,
          type: "bar",
          data: rev(a.values),
          barMaxWidth: 16,
          barGap: "25%",
          itemStyle: { color: t.accent, borderRadius: [0, 4, 4, 0] },
          label: valueLabel,
        },
        {
          name: b.label,
          type: "bar",
          data: rev(b.values),
          barMaxWidth: 16,
          itemStyle: { color: t.series2, borderRadius: [0, 4, 4, 0] },
          label: valueLabel,
        },
      ],
    };
  }, [t, categories, a, b]);

  return (
    <div>
      <EChart
        option={option}
        height={height ?? Math.max(200, categories.length * 56 + 40)}
        ariaLabel={`${a.label} e ${b.label} por categoria`}
        onClickName={
          filterKey
            ? (name) => navigate(hrefFor({ ...state, filters: { ...state.filters, [filterKey]: [name] } }))
            : undefined
        }
      />
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-ink-2">
        <LegendKey shape="rect" color="var(--accent)" label={a.label} />
        <LegendKey shape="rect" color="var(--series-2)" label={b.label} />
        {filterKey && <span className="no-export text-muted">Clique numa barra para filtrar o painel</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mini tendência diária com marcação de dias anômalos (qualidade dos dados).
// ---------------------------------------------------------------------------

export function MiniTrend({
  title,
  points,
  anomalies,
}: {
  title: string;
  points: { date: string; value: number }[];
  anomalies: string[];
}) {
  const t = useChartTheme();
  const option = useMemo(() => {
    if (!t) return null;
    const ax = axisStyle(t);
    const set = new Set(anomalies);
    return {
      ...baseOption(t),
      grid: { left: 4, right: 8, top: 8, bottom: 4, containLabel: true },
      xAxis: { type: "category", data: points.map((p) => fmtDay(p.date)), ...ax, axisLabel: { show: false }, splitLine: { show: false } },
      yAxis: {
        type: "value",
        ...ax,
        axisLine: { show: false },
        splitNumber: 2,
        axisLabel: { ...ax.axisLabel, formatter: (v: number) => formatValue(v, "int", { compact: true }) },
      },
      tooltip: {
        ...(baseOption(t).tooltip as object),
        trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: t.axis, width: 1 } },
        formatter: (params: { dataIndex: number }[]) => {
          const p = points[params[0].dataIndex];
          return tooltipRows(fmtDay(p.date), [
            { color: set.has(p.date) ? t.highlight : t.accent, label: set.has(p.date) ? `${title} · queda` : title, value: formatValue(p.value, "int") },
          ]);
        },
      },
      series: [
        {
          type: "line",
          data: points.map((p) => p.value),
          symbol: "none",
          lineStyle: { width: 2.5, color: t.accent },
        },
        {
          type: "scatter",
          data: points.map((p) => (set.has(p.date) ? p.value : null)),
          symbolSize: 11,
          itemStyle: { color: t.highlight, borderColor: t.surface, borderWidth: 2 },
        },
      ],
    };
  }, [t, points, anomalies, title]);

  return <EChart option={option} height={140} ariaLabel={`${title} por dia`} />;
}

"use client";

import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { LabelLayout } from "echarts/features";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef, useState } from "react";

// Renderer SVG: nítido, acessível ao "Exportar HTML" (o SVG vai junto no arquivo).
// LabelLayout: esconde rótulos de pontos que se sobrepõem (matriz de oportunidade).
echarts.use([LineChart, BarChart, ScatterChart, GridComponent, TooltipComponent, LegendComponent, MarkLineComponent, MarkAreaComponent, LabelLayout, SVGRenderer]);

export type ChartInstance = echarts.ECharts;

export type ChartTheme = {
  surface: string;
  ink: string;
  ink2: string;
  muted: string;
  grid: string;
  axis: string;
  accent: string;
  series2: string;
  series3: string;
  compare: string;
  critical: string;
  /** Destaque (Sinopia): maiores oportunidades. */
  highlight: string;
  border: string;
  /** Família da fonte do corpo (a Montserrat do next/font tem nome gerado; lida do documento). */
  font: string;
  /** Tamanho base do texto dos gráficos em px. Acompanha a fonte da página, que cresce em monitores grandes. */
  fs: number;
};

function readTheme(): ChartTheme {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    surface: v("--surface"),
    ink: v("--ink"),
    ink2: v("--ink-2"),
    muted: v("--muted"),
    grid: v("--grid"),
    axis: v("--axis"),
    accent: v("--accent"),
    series2: v("--series-2"),
    series3: v("--series-3"),
    compare: v("--compare"),
    critical: v("--critical"),
    highlight: v("--highlight"),
    border: v("--border"),
    font: getComputedStyle(document.body).fontFamily || "system-ui, sans-serif",
    fs: Math.round((parseFloat(s.fontSize) || 16) * 0.8),
  };
}

/** Tema atual (claro/escuro) lido dos tokens CSS; atualiza quando o sistema troca o modo. */
export function useChartTheme(): ChartTheme | null {
  const [theme, setTheme] = useState<ChartTheme | null>(null);
  useEffect(() => {
    setTheme(readTheme());
    // Troca de tema (do sistema ou pelo botão, que muda data-theme no <html>) e dos degraus de fonte (1900px e 2400px).
    const queries = ["(prefers-color-scheme: dark)", "(min-width: 1900px)", "(min-width: 2400px)"].map((q) => window.matchMedia(q));
    const onChange = () => setTheme(readTheme());
    queries.forEach((mq) => mq.addEventListener("change", onChange));
    const mo = new MutationObserver(onChange);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      queries.forEach((mq) => mq.removeEventListener("change", onChange));
      mo.disconnect();
    };
  }, []);
  return theme;
}

/** Base comum: tooltip, eixos e grid recessivos (hairline sólida), fonte do painel. */
export function baseOption(t: ChartTheme): echarts.EChartsCoreOption {
  return {
    animationDuration: 300,
    textStyle: { fontFamily: t.font, color: t.ink2 },
    tooltip: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      padding: [10, 12],
      textStyle: { color: t.ink, fontSize: t.fs + 1 },
      extraCssText: "box-shadow:0 12px 32px -8px rgba(16,18,40,.22);border-radius:8px;",
    },
  };
}

export function axisStyle(t: ChartTheme) {
  return {
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: t.fs },
    splitLine: { lineStyle: { color: t.grid, type: "solid" as const, width: 1 } },
  };
}

/**
 * Linha de tooltip montada com DOM e textContent (rótulos vêm da API, nunca via innerHTML).
 * Valor em destaque primeiro, nome da série depois, com um traço da cor da série.
 */
export function tooltipRows(title: string, rows: { color: string; label: string; value: string; dashed?: boolean }[]) {
  const box = document.createElement("div");
  const h = document.createElement("div");
  h.textContent = title;
  h.style.cssText = "font-size:.88em;opacity:.7;margin-bottom:4px";
  box.appendChild(h);
  for (const r of rows) {
    const line = document.createElement("div");
    line.style.cssText = "display:flex;align-items:center;gap:8px;line-height:1.7";
    const key = document.createElement("span");
    key.style.cssText = `display:inline-block;width:12px;height:0;border-top:2px ${r.dashed ? "dashed" : "solid"} ${r.color}`;
    const val = document.createElement("strong");
    val.textContent = r.value;
    val.style.cssText = "font-variant-numeric:tabular-nums";
    const lab = document.createElement("span");
    lab.textContent = r.label;
    lab.style.cssText = "opacity:.75";
    line.append(key, val, lab);
    box.appendChild(line);
  }
  return box;
}

export function EChart({
  option,
  height = 280,
  ariaLabel,
  onClickName,
  instanceRef,
}: {
  option: echarts.EChartsCoreOption | null;
  /** Altura em px ou CSS (ex.: "clamp(260px, 17vw, 420px)" para crescer em telas largas). */
  height?: number | string;
  ariaLabel: string;
  onClickName?: (name: string) => void;
  /** Recebe a instância, para o componente pai acender pontos e abrir o tooltip (ex.: lista ao lado). */
  instanceRef?: { current: ChartInstance | null };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const c = echarts.init(ref.current, undefined, { renderer: "svg" });
    chart.current = c;
    if (instanceRef) instanceRef.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
      if (instanceRef) instanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (option && chart.current) chart.current.setOption(option, { notMerge: true });
  }, [option]);

  useEffect(() => {
    const c = chart.current;
    if (!c || !onClickName) return;
    const handler = (p: echarts.ECElementEvent) => {
      const data = p.data as { name?: string } | null | undefined;
      const name = (data && typeof data === "object" ? data.name : undefined) ?? p.name;
      if (name) onClickName(name);
    };
    c.on("click", handler);
    return () => {
      c.off("click", handler);
    };
  }, [onClickName]);

  return <div ref={ref} role="img" aria-label={ariaLabel} style={{ height, width: "100%" }} />;
}

import clsx from "clsx";
import { ArrowDown, ArrowUp, CircleCheck, CircleExclamationPoint, Info, Minus, OctagonExclamationPoint } from "lucide-react";

import { fmtSignedPct, formatValue, relChange, type FormatKind } from "@/lib/format";

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx("refetch-dim min-w-0 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6 2xl:p-7", className)}>
      {(title || actions) && <CardHeader title={title} subtitle={subtitle} actions={actions} />}
      {children}
    </section>
  );
}

/** Título de bloco (com ou sem cartão em volta): título à esquerda, ação discreta à direita. */
export function CardHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={clsx("mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0">
        {title && <h2 className="text-[1.0625rem] leading-snug font-semibold text-ink">{title}</h2>}
        {subtitle && <p className="mt-1 max-w-[110ch] text-[0.8125rem] leading-relaxed text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="no-export flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Título da página: vem antes da linha de filtros (a ordem é feita no DashboardShell). */
export function PageHeader({ title, description }: { title: string; description?: React.ReactNode }) {
  return (
    <div className="order-first mb-3 pt-2">
      <h1 className="text-[1.75rem] leading-tight font-bold text-ink sm:text-[2rem]">{title}</h1>
      {description && <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted">{description}</p>}
    </div>
  );
}

export type Better = "up" | "down" | "neutral";

/** Variação com ícone + texto (a cor nunca carrega o sentido sozinha). */
export function Delta({
  cur,
  prev,
  better = "up",
  className,
}: {
  cur: number;
  prev: number | undefined | null;
  better?: Better;
  className?: string;
}) {
  const change = relChange(cur, prev);
  if (change === null) return <span className={clsx("text-xs text-muted", className)}>sem base</span>;
  const flat = Math.abs(change) < 0.005;
  const good = better === "neutral" || flat ? null : (change > 0) === (better === "up");
  const Icon = flat ? Minus : change > 0 ? ArrowUp : ArrowDown;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-0.5 text-xs font-medium tabular",
        good === null ? "text-ink-2" : good ? "text-good-ink" : "text-critical-ink",
        className,
      )}
    >
      <Icon size={12} strokeWidth={2.5} aria-hidden />
      {fmtSignedPct(change)}
    </span>
  );
}

/**
 * Números principais num só bloco, divididos por linhas de 1px (sem caixinhas separadas).
 * `count` é o número de células: em telas bem largas todas ficam numa linha só.
 */
export function KpiStrip({
  children,
  count,
  cols = 4,
  className,
}: {
  children: React.ReactNode;
  count: number;
  /** Colunas a partir de telas médias (abaixo disso são 2). */
  cols?: 2 | 3 | 4;
  className?: string;
}) {
  return (
    <div className={clsx("refetch-dim overflow-hidden rounded-2xl border border-line bg-surface shadow-card", className)}>
      <div
        style={{ "--kpi-cols": count } as React.CSSProperties}
        className={clsx(
          "-mr-px -mb-px grid grid-cols-2 *:border-r *:border-b *:border-line",
          cols === 3 && "md:grid-cols-3",
          cols === 4 && "md:grid-cols-4",
          cols === 4 && count > 4 && "min-[112.5rem]:grid-cols-[repeat(var(--kpi-cols),minmax(0,1fr))]",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** Célula de número: rótulo, valor, variação contra o período de comparação e o valor anterior. */
export function KpiTile({
  label,
  value,
  prev,
  format,
  better = "up",
  note,
  incomparable,
}: {
  label: string;
  value: number;
  prev?: number;
  format: FormatKind;
  better?: Better;
  note?: string;
  /** A forma de medir mudou entre os períodos: a variação não é mostrada (não mede mudança real). */
  incomparable?: string;
}) {
  return (
    <div className="min-w-0 px-4 py-4 sm:px-5 2xl:px-6">
      <p className="truncate text-xs font-medium text-ink-2 sm:text-[0.8125rem]" title={label}>
        {label}
      </p>
      <p className="tabular mt-2 text-[1.375rem] leading-none font-bold tracking-[-0.03em] text-ink sm:text-[1.625rem]">
        {formatValue(value, format, { compact: true })}
      </p>
      {prev !== undefined && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          {incomparable ? (
            <span className="inline-flex items-center gap-1 font-medium text-warning-ink" title={incomparable}>
              <CircleExclamationPoint size={12} strokeWidth={2.5} aria-hidden />
              medição mudou
            </span>
          ) : (
            <Delta cur={value} prev={prev} better={better} />
          )}
          <span className="text-muted">antes {formatValue(prev, format, { compact: true })}</span>
        </div>
      )}
      {note && <p className="mt-2 text-xs leading-snug text-muted">{note}</p>}
    </div>
  );
}

/** Variação em pílula (ícone + texto; a cor de fundo reforça, nunca carrega o sentido sozinha). */
export function DeltaPill({ cur, prev, better = "up" }: { cur: number; prev: number | undefined | null; better?: Better }) {
  const change = relChange(cur, prev);
  if (change === null) return <span className="rounded-full bg-raised px-2 py-0.5 text-xs text-muted">sem base</span>;
  const flat = Math.abs(change) < 0.005;
  const good = better === "neutral" || flat ? null : (change > 0) === (better === "up");
  const Icon = flat ? Minus : change > 0 ? ArrowUp : ArrowDown;
  return (
    <span
      className={clsx(
        "tabular inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold",
        good === null ? "bg-raised text-ink-2" : good ? "bg-good/12 text-good-ink" : "bg-critical/10 text-critical-ink",
      )}
    >
      <Icon size={12} strokeWidth={2.75} aria-hidden />
      {fmtSignedPct(change)}
    </span>
  );
}

/**
 * Minigráfico em SVG puro (sem script): linha do período e, tracejada, a do período de comparação.
 * Os dois ficam na mesma escala; o eixo x é a posição do dia no período.
 */
export function Sparkline({ values, prev, className }: { values: number[]; prev?: number[]; className?: string }) {
  if (values.length < 2) return null;
  const all = [...values, ...(prev ?? [])];
  const max = Math.max(...all, 1e-9);
  const n = Math.max(values.length, prev?.length ?? 0);
  const pts = (v: number[]) => v.map((y, i) => `${((i / (n - 1)) * 100).toFixed(2)},${(30 - (y / max) * 27).toFixed(2)}`);
  const line = pts(values);
  return (
    <svg viewBox="0 0 100 31" preserveAspectRatio="none" className={clsx("block w-full", className)} aria-hidden>
      <path d={`M0,31 L${line.join(" L")} L${line.at(-1)!.split(",")[0]},31 Z`} fill="var(--accent)" opacity={0.1} />
      {prev && prev.length > 1 && (
        <polyline
          points={pts(prev).join(" ")}
          fill="none"
          stroke="var(--compare)"
          strokeWidth={1.5}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <polyline points={line.join(" ")} fill="none" stroke="var(--accent)" strokeWidth={2.25} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** Cartão de número principal: rótulo, valor grande, variação em pílula, valor anterior e minigráfico. */
export function KpiCard({
  label,
  value,
  prev,
  format,
  better = "up",
  note,
  incomparable,
  compareText,
  spark,
  prevSpark,
}: {
  label: string;
  value: number;
  prev?: number;
  format: FormatKind;
  better?: Better;
  note?: string;
  incomparable?: string;
  /** "semana anterior", "mês anterior"... */
  compareText?: string;
  spark?: number[];
  prevSpark?: number[];
}) {
  return (
    <div className="refetch-dim flex min-w-0 flex-col rounded-2xl border border-line bg-surface p-5 shadow-card 2xl:p-6">
      <div className="flex items-start justify-between gap-3">
        <p className="truncate text-sm font-medium text-ink-2" title={label}>
          {label}
        </p>
        {prev !== undefined &&
          (incomparable ? (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning-ink"
              title={incomparable}
            >
              <CircleExclamationPoint size={12} strokeWidth={2.5} aria-hidden />
              medição mudou
            </span>
          ) : (
            <DeltaPill cur={value} prev={prev} better={better} />
          ))}
      </div>
      <p className="tabular mt-3 text-[2.25rem] leading-none font-bold tracking-[-0.035em] text-ink">
        {formatValue(value, format, { compact: true })}
      </p>
      {prev !== undefined && (
        <p className="mt-2 text-xs text-muted">
          {compareText ? `${compareText.charAt(0).toUpperCase()}${compareText.slice(1)}: ` : "Antes: "}
          <span className="tabular font-medium text-ink-2">{formatValue(prev, format, { compact: true })}</span>
        </p>
      )}
      {note && <p className="mt-1 text-xs leading-snug text-muted">{note}</p>}
      {spark && spark.length > 1 && (
        <div className="mt-auto pt-4">
          <Sparkline values={spark} prev={prevSpark} className="h-12" />
        </div>
      )}
    </div>
  );
}

const TONES = {
  info: { icon: Info, box: "border-line bg-surface", icon_: "text-accent" },
  warning: { icon: CircleExclamationPoint, box: "border-warning/50 bg-warning/10", icon_: "text-warning-ink" },
  critical: { icon: OctagonExclamationPoint, box: "border-critical/40 bg-critical/10", icon_: "text-critical-ink" },
  good: { icon: CircleCheck, box: "border-good/40 bg-good/10", icon_: "text-good-ink" },
} as const;

export type Tone = keyof typeof TONES;

export function Notice({ tone = "info", title, children }: { tone?: Tone; title?: string; children: React.ReactNode }) {
  const t = TONES[tone];
  const Icon = t.icon;
  return (
    <div className={clsx("refetch-dim flex gap-3 rounded-2xl border px-4 py-3 text-sm", t.box)}>
      <Icon size={18} aria-hidden className={clsx("mt-px shrink-0", t.icon_)} />
      <div className="max-w-[120ch] min-w-0 text-ink">
        {title && <p className="font-semibold">{title}</p>}
        <div className={clsx("text-ink-2", title && "mt-0.5")}>{children}</div>
      </div>
    </div>
  );
}

export function Badge({ tone = "info", children }: { tone?: Tone; children: React.ReactNode }) {
  const t = TONES[tone];
  const Icon = t.icon;
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap text-ink", t.box)}>
      <Icon size={12} aria-hidden className={t.icon_} />
      {children}
    </span>
  );
}

export function ErrorBlock({ message }: { message: string }) {
  return (
    <Notice tone="warning" title="Não foi possível carregar este bloco">
      {message}
    </Notice>
  );
}

/** Bloco de carregamento (o pulso indica que os dados estão chegando). */
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-2xl bg-raised", className)} />;
}

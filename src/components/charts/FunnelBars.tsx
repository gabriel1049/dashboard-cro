import { ArrowDown, CornerDownRight } from "lucide-react";

import { Badge } from "@/components/ui/primitives";
import { ExportData } from "@/components/ui/CardExport";
import { fmtInt, fmtPct, fmtPP } from "@/lib/format";
import type { FunnelStep } from "@/lib/ga4/funnel";

/**
 * Funil em barras horizontais (uma série, uma cor). Entre as etapas: quanto segue, quanto
 * abandona e a variação da taxa de passagem contra o período de comparação.
 */
export function FunnelBars({
  steps,
  prev,
  disconnected = [],
  exits = [],
  worstFrom = 0,
}: {
  steps: FunnelStep[];
  prev?: FunnelStep[];
  /** Índices de etapas sem ligação com a anterior: a passagem até elas não conta como "maior perda". */
  disconnected?: number[];
  /** Telas de saída da jornada (ex.: sem plano para a renda), mostradas logo abaixo da etapa em que acontecem. */
  exits?: { afterIndex: number; label: string; users: number }[];
  /** Primeira passagem considerada para "Maior perda". */
  worstFrom?: number;
}) {
  const cut = new Set(disconnected);
  const drops = steps.map((s, i) => (i < worstFrom || cut.has(i + 1) ? -1 : (s.dropRate ?? -1) * (s.users >= 30 ? 1 : 0)));
  const worst = drops.indexOf(Math.max(...drops));

  return (
    <ol className="space-y-1">
      <ExportData
        table={{
          columns: [
            { key: "n", label: "Etapa", format: "int" },
            { key: "label", label: "Nome", format: "text" },
            { key: "users", label: "Usuários", format: "int" },
            { key: "fromStart", label: "% do início", format: "pct" },
            { key: "nextRate", label: "Seguem para a próxima", format: "pct" },
            { key: "dropRate", label: "Abandonam", format: "pct" },
            ...(prev ? [{ key: "prevUsers", label: "Usuários (comparação)", format: "int" as const }] : []),
          ],
          rows: steps.map((s, i) => ({
            n: i + 1,
            label: s.label,
            users: s.users,
            fromStart: s.fromStart,
            nextRate: s.nextRate,
            dropRate: s.dropRate,
            prevUsers: prev?.[i]?.users,
          })),
        }}
      />
      {steps.map((s, i) => {
        const p = prev?.[i];
        const passDiff = s.nextRate !== null && p?.nextRate !== null && p?.nextRate !== undefined ? s.nextRate - p.nextRate : null;
        return (
          <li key={s.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-ink">
                <span className="mr-1.5 text-muted tabular">{i + 1}.</span>
                {s.label}
                {!s.detail && <span className="ml-1.5 text-xs text-muted">{s.event}</span>}
              </span>
              <span className="shrink-0 tabular">
                <strong className="font-semibold text-ink">{fmtInt(s.users)}</strong>
                <span className="ml-2 text-xs text-muted">{fmtPct(s.fromStart)} do início</span>
              </span>
            </div>
            <div className="mt-1.5 h-7 w-full rounded-sm bg-raised">
              <div
                className="h-full rounded-r bg-accent"
                style={{ width: `${Math.max(s.fromStart * 100, s.users ? 0.6 : 0)}%` }}
                aria-hidden
              />
            </div>
            {s.nextRate !== null && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 pl-1 text-xs text-ink-2">
                <ArrowDown size={13} aria-hidden className="text-muted" />
                <span>
                  <strong className="text-ink tabular">{fmtPct(s.nextRate)}</strong> seguem
                </span>
                <span>
                  <strong className="text-ink tabular">{fmtPct(s.dropRate)}</strong> abandonam (
                  {fmtInt(s.users - steps[i + 1].users)})
                </span>
                {passDiff !== null && (
                  <span className={passDiff >= 0 ? "text-good-ink" : "text-critical-ink"}>
                    passagem {fmtPP(passDiff)} vs comparação
                  </span>
                )}
                {i === worst && s.dropRate !== null && s.dropRate > 0 && <Badge tone="critical">Maior perda</Badge>}
                {cut.has(i + 1) && <Badge tone="warning">Etapa seguinte desconectada</Badge>}
              </div>
            )}
            {exits
              .filter((x) => x.afterIndex === i && x.users > 0)
              .map((x) => (
                <p key={x.label} className="-mt-1 flex items-center gap-1.5 pb-2 pl-1 text-xs text-ink-2">
                  <CornerDownRight size={13} aria-hidden className="text-highlight" />
                  <strong className="text-ink tabular">{fmtInt(x.users)}</strong> viram &quot;{x.label}&quot;
                  {s.users > 0 && <span className="text-muted">({fmtPct(Math.min(x.users / s.users, 1), 0)} de quem chegou aqui)</span>}
                </p>
              ))}
          </li>
        );
      })}
    </ol>
  );
}

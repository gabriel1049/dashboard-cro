import clsx from "clsx";

import { fmtCompact, fmtInt, fmtPct } from "@/lib/format";
import { ExportData } from "@/components/ui/CardExport";

export type HeatRow = {
  segment: string;
  /** Usuários no site no recorte (base da taxa de início). */
  siteUsers?: number;
  /** Usuários em cada etapa (funil fechado). */
  users: number[];
};

/**
 * Funil por segmento em forma de mapa de calor: cada linha é um segmento (campanha, origem...),
 * cada coluna uma etapa, e a célula mostra quanto de quem começou chegou ali (o tom acompanha).
 * A pior passagem de cada linha ganha um traço na cor de destaque.
 */
export function FunnelHeatTable({
  steps,
  rows,
  total,
  segmentLabel,
  minUsers = 30,
  unit = "usuários",
  siteLabel = "No site",
}: {
  steps: string[];
  rows: HeatRow[];
  total: HeatRow;
  segmentLabel: string;
  /** Abaixo disso a linha aparece esmaecida (amostra pequena). */
  minUsers?: number;
  /** O que a contagem mede (usuários no funil fechado, sessões no comparativo por categoria). */
  unit?: string;
  siteLabel?: string;
}) {
  const hasSite = rows.some((r) => r.siteUsers !== undefined);
  const overall = total.users[0] ? total.users.at(-1)! / total.users[0] : 0;
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ExportData
        table={{
          columns: [
            { key: "segment", label: segmentLabel, format: "text" },
            ...(hasSite ? [{ key: "site", label: `${siteLabel} (${unit})`, format: "int" as const }] : []),
            ...steps.map((s, i) => ({ key: `s${i}`, label: `${i + 1}. ${s} (${unit})`, format: "int" as const })),
            { key: "conv", label: "1ª → última", format: "pct" },
          ],
          rows: [total, ...rows].map((r) => ({
            segment: r.segment,
            site: r.siteUsers,
            ...Object.fromEntries(r.users.map((u, i) => [`s${i}`, u])),
            conv: r.users[0] ? r.users.at(-1)! / r.users[0] : null,
          })),
        }}
      />
      <table className="w-full min-w-max border-separate border-spacing-x-1 border-spacing-y-1 text-sm tabular">
        <thead>
          <tr className="text-xs text-muted">
            <th scope="col" className="pr-3 pb-1 text-left align-bottom font-medium">
              {segmentLabel}
            </th>
            {hasSite && (
              <th scope="col" className="px-2 pb-1 text-right align-bottom font-medium">
                {siteLabel}
              </th>
            )}
            {steps.map((s, i) => (
              <th key={s} scope="col" className="w-[6.5rem] px-1 pb-1 text-left align-bottom font-medium">
                <span className="block text-ink-2 tabular">{i + 1}</span>
                <span className="block leading-tight">{s}</span>
              </th>
            ))}
            <th scope="col" className="pb-1 pl-2 text-right align-bottom font-medium">
              1ª → última
            </th>
          </tr>
        </thead>
        <tbody>
          {[total, ...rows].map((r, ri) => (
            <HeatLine
              key={`${ri}-${r.segment}`}
              row={r}
              hasSite={hasSite}
              isTotal={ri === 0}
              overall={overall}
              minUsers={minUsers}
              unit={unit}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HeatLine({
  row,
  hasSite,
  isTotal,
  overall,
  minUsers,
  unit,
}: {
  row: HeatRow;
  hasSite: boolean;
  isTotal: boolean;
  overall: number;
  minUsers: number;
  unit: string;
}) {
  const first = row.users[0] ?? 0;
  const rate = first ? (row.users.at(-1) ?? 0) / first : 0;
  // Pior passagem da linha (só com volume para não marcar ruído).
  let worst = -1;
  let worstDrop = 0;
  row.users.forEach((u, i) => {
    if (i === 0) return;
    const prev = row.users[i - 1];
    const drop = prev >= minUsers ? 1 - u / prev : 0;
    if (drop > worstDrop) {
      worstDrop = drop;
      worst = i;
    }
  });
  const small = !isTotal && first < minUsers;
  const below = !isTotal && !small && overall > 0 && rate < overall * 0.6;
  const above = !isTotal && !small && overall > 0 && rate > overall * 1.4;
  return (
    <tr className={clsx(small && "opacity-55")}>
      <th scope="row" className={clsx("max-w-[10rem] pr-3 text-left font-normal sm:max-w-[22rem]", isTotal ? "font-semibold text-ink" : "text-ink")}>
        <span className="block truncate" title={row.segment}>
          {row.segment}
        </span>
      </th>
      {hasSite && (
        <td className="px-2 text-right text-ink-2">
          {row.siteUsers !== undefined ? fmtCompact(row.siteUsers) : "–"}
          {row.siteUsers ? <span className="block text-xs text-muted">{fmtPct(first / row.siteUsers, 1)} iniciam</span> : null}
        </td>
      )}
      {row.users.map((u, i) => {
        const share = first ? u / first : 0;
        const prev = i > 0 ? row.users[i - 1] : 0;
        const pass = i > 0 && prev ? u / prev : null;
        return (
          <td
            key={i}
            title={`${fmtInt(u)} ${unit} · ${fmtPct(share)} de quem iniciou${pass !== null ? ` · ${fmtPct(pass)} seguiram da etapa anterior` : ""}`}
            className={clsx("relative h-11 rounded-md px-2 align-middle", i === worst && "shadow-[inset_0_-3px_0_var(--highlight)]")}
            style={{ background: `color-mix(in oklab, var(--accent) ${Math.round(6 + Math.sqrt(share) * 44)}%, var(--surface))` }}
          >
            <span className="block text-[0.8125rem] leading-none font-semibold text-ink">{i === 0 ? fmtCompact(u) : fmtPct(share, 0)}</span>
            <span className="mt-1 block text-[0.6875rem] leading-none text-ink-2">{i === 0 ? "iniciaram" : fmtCompact(u)}</span>
          </td>
        );
      })}
      <td className="pl-2 text-right">
        <span className={clsx("font-semibold", below ? "text-critical-ink" : above ? "text-good-ink" : "text-ink")}>{fmtPct(rate, 1)}</span>
        {(below || above) && (
          <span className="block text-xs text-muted">{below ? "abaixo do total" : "acima do total"}</span>
        )}
      </td>
    </tr>
  );
}

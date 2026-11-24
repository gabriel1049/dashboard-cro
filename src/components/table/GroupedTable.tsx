"use client";

import clsx from "clsx";
import { ChevronRight, Filter } from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import { useDashboardNav } from "@/components/shell/PendingProvider";
import { useStateHref } from "@/components/shell/useStateHref";
import { Delta, type Better } from "@/components/ui/primitives";
import { ExportData } from "@/components/ui/CardExport";
import type { CsvTable } from "@/lib/csv";
import { formatValue, type FormatKind } from "@/lib/format";
import type { FilterKey } from "@/lib/state";

/** Métrica mostrada nas linhas de grupo e nas de detalhe. */
export type GroupMetric = {
  key: string;
  label: string;
  format: FormatKind;
  delta?: boolean;
  bar?: boolean;
  better?: Better;
  help?: string;
};

/** Grupo (ou item do detalhe, em children) com os valores do período e os da comparação. */
export type GroupNode = {
  id: string;
  label: string;
  values: Record<string, number>;
  prev?: Record<string, number>;
  children?: GroupNode[];
  /** Itens do detalhe que ficaram de fora da lista (volume baixo). */
  more?: number;
};

// Grupos visíveis antes de "Mostrar todos".
const PAGE = 12;

/**
 * Tabela agrupada: cada grupo (campanha, origem, página) abre os itens de outra dimensão, para
 * comparar lado a lado em vez de filtrar um por vez. O funil dá para filtrar pelo grupo direto da linha.
 */
export function GroupedTable({
  groupLabel,
  groupPlural,
  detailLabel,
  metrics,
  groups,
  filterKey,
}: {
  groupLabel: string;
  groupPlural: string;
  detailLabel: string;
  metrics: GroupMetric[];
  groups: GroupNode[];
  /** Filtro global aplicado pelo botão da linha do grupo. */
  filterKey?: FilterKey;
}) {
  // O primeiro grupo já vem aberto, para deixar claro que as linhas expandem.
  const [open, setOpen] = useState<Set<string>>(() => new Set(groups.slice(0, 1).map((g) => g.id)));
  const [all, setAll] = useState(false);
  const { state, hrefFor } = useStateHref();
  const { navigate } = useDashboardNav();
  // Escala das barras pelo maior grupo; os itens do detalhe usam a mesma escala.
  const max = useMemo(() => {
    const out: Record<string, number> = {};
    for (const m of metrics) if (m.bar) out[m.key] = Math.max(0, ...groups.map((g) => g.values[m.key] ?? 0));
    return out;
  }, [groups, metrics]);
  const shown = all ? groups : groups.slice(0, PAGE);
  // CSV: uma linha por grupo e, abaixo, uma por item do detalhe (todos, abertos ou não).
  const csv = useMemo<CsvTable>(() => {
    const cols: CsvTable["columns"] = [
      { key: "group", label: groupLabel, format: "text" },
      { key: "detail", label: detailLabel, format: "text" },
    ];
    for (const m of metrics) {
      cols.push({ key: m.key, label: m.label, format: m.format });
      if (m.delta) cols.push({ key: `${m.key}__prev`, label: `${m.label} (comparação)`, format: m.format });
    }
    const line = (g: GroupNode, n: GroupNode, child: boolean) => {
      const out: CsvTable["rows"][number] = { group: g.label, detail: child ? n.label : "(total do grupo)" };
      for (const m of metrics) {
        out[m.key] = n.values[m.key];
        if (m.delta) out[`${m.key}__prev`] = n.prev?.[m.key];
      }
      return out;
    };
    return { columns: cols, rows: groups.flatMap((g) => [line(g, g, false), ...(g.children ?? []).map((c) => line(g, c, true))]) };
  }, [groups, metrics, groupLabel, detailLabel]);
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const cells = (node: GroupNode, child: boolean) =>
    metrics.map((m) => {
      const v = node.values[m.key];
      const p = node.prev?.[m.key];
      return (
        <td key={m.key} className="py-2.5 pl-4 text-right align-top">
          <div className="relative flex flex-col items-end">
            {m.bar && max[m.key] > 0 && v !== undefined && (
              <span
                aria-hidden
                className={clsx("absolute inset-y-0 right-0 -my-1 rounded-sm", child ? "bg-raised" : "bg-accent-wash")}
                style={{ width: `${(v / max[m.key]) * 100}%` }}
              />
            )}
            <span className={clsx("relative", child ? "text-ink-2" : "font-medium text-ink")}>{formatValue(v ?? null, m.format)}</span>
            {m.delta && v !== undefined && p !== undefined && <Delta className="relative" cur={v} prev={p} better={m.better} />}
          </div>
        </td>
      );
    });

  return (
    <div>
      <ExportData table={csv} />
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-max text-sm tabular">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th scope="col" className="py-2 pr-4 text-left font-medium">
                {groupLabel} <span className="text-muted/80">› {detailLabel.toLowerCase()}</span>
              </th>
              {metrics.map((m) => (
                <th key={m.key} scope="col" title={m.help} className="py-2 pl-4 text-right font-medium">
                  {m.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((g) => {
              const isOpen = open.has(g.id);
              const canFilter = filterKey && g.label !== "(not set)" && g.label !== "(sem valor)";
              return (
                <Fragment key={g.id}>
                  <tr className={clsx("border-b border-rule", isOpen && "bg-raised/60")}>
                    <th scope="row" className="py-2.5 pr-4 text-left align-top font-normal">
                      <div className="flex items-start gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggle(g.id)}
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? "Fechar" : "Abrir"} ${g.label}`}
                          className="-ml-1 grid size-6 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-active hover:text-ink"
                        >
                          <ChevronRight size={14} aria-hidden className={clsx("transition-transform", isOpen && "rotate-90")} />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggle(g.id)}
                          className="max-w-[30rem] truncate pt-0.5 text-left font-semibold text-ink"
                          title={g.label}
                        >
                          {g.label}
                        </button>
                        {canFilter && (
                          <button
                            type="button"
                            title={`Filtrar o painel (e o funil) por ${g.label}`}
                            aria-label={`Filtrar por ${g.label}`}
                            onClick={() => navigate(hrefFor({ ...state, filters: { ...state.filters, [filterKey]: [g.label] } }))}
                            className="no-export mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-muted hover:bg-active hover:text-accent"
                          >
                            <Filter size={13} aria-hidden />
                          </button>
                        )}
                      </div>
                    </th>
                    {cells(g, false)}
                  </tr>
                  {isOpen &&
                    (g.children ?? []).map((c) => (
                      <tr key={`${g.id}>${c.id}`} className="border-b border-rule bg-raised/60">
                        <th scope="row" className="py-2 pr-4 pl-9 text-left align-top font-normal">
                          <span className="block max-w-[30rem] truncate text-ink-2" title={c.label}>
                            {c.label}
                          </span>
                        </th>
                        {cells(c, true)}
                      </tr>
                    ))}
                  {isOpen && (g.more ?? 0) > 0 && (
                    <tr className="border-b border-rule bg-raised/60">
                      <td colSpan={metrics.length + 1} className="py-2 pl-9 text-xs text-muted">
                        + {g.more} {detailLabel.toLowerCase()} com menos volume
                      </td>
                    </tr>
                  )}
                  {isOpen && !(g.children ?? []).length && (
                    <tr className="border-b border-rule bg-raised/60">
                      <td colSpan={metrics.length + 1} className="py-2 pl-9 text-xs text-muted">
                        Sem detalhe para este grupo.
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="no-export mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-2">
        <span className="text-muted">
          {shown.length} de {groups.length} {groupPlural}, por sessões
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setOpen(open.size ? new Set() : new Set(shown.map((g) => g.id)))}
            className="h-8 rounded-full px-3 hover:bg-raised hover:text-ink"
          >
            {open.size ? "Fechar todos" : "Abrir todos"}
          </button>
          {groups.length > PAGE && (
            <button type="button" onClick={() => setAll(!all)} className="h-8 rounded-full border border-line bg-surface px-3 hover:text-ink">
              {all ? "Mostrar menos" : `Mostrar todos (${groups.length})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

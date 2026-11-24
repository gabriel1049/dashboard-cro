"use client";

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import clsx from "clsx";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { useDashboardNav } from "@/components/shell/PendingProvider";
import { useStateHref } from "@/components/shell/useStateHref";
import { ExportData, useInExportCard } from "@/components/ui/CardExport";
import { Badge, Delta, type Better, type Tone } from "@/components/ui/primitives";
import { downloadCsv, type CsvTable } from "@/lib/csv";
import { formatValue, type FormatKind } from "@/lib/format";
import type { FilterKey } from "@/lib/state";

/**
 * Tabela padrão do painel (TanStack Table): ordenação, busca nas colunas de dimensão, paginação,
 * barras de dados, variação contra o período de comparação e exportação em CSV.
 */

/** Coluna da tabela: dimensão (texto, pode virar filtro) ou métrica (número formatado). */
export type ColumnSpec = {
  key: string;
  label: string;
  type: "dim" | "metric";
  format?: FormatKind;
  /** Barra de dados atrás do número (proporcional ao maior valor da coluna). */
  bar?: boolean;
  /** Mostra a variação contra o período de comparação. */
  delta?: boolean;
  better?: Better;
  /** Clicar no valor aplica este filtro global. */
  filterKey?: FilterKey;
  help?: string;
};

/** Linha: valores do período atual, os da comparação (prev) e alertas opcionais. */
export type TableRow = {
  id: string;
  values: Record<string, string | number | null>;
  prev?: Record<string, number | null>;
  flags?: { label: string; tone: Tone }[];
};

/** Tabela ordenável e paginada. Clicar num valor de dimensão com filterKey filtra o painel todo por ele. */
export function DataTable({
  columns,
  rows,
  filename,
  initialSort,
  pageSize = 15,
  searchable = true,
}: {
  columns: ColumnSpec[];
  rows: TableRow[];
  filename: string;
  initialSort?: { key: string; desc?: boolean };
  pageSize?: number;
  searchable?: boolean;
}) {
  const [sorting, setSorting] = useState<SortingState>(
    initialSort ? [{ id: initialSort.key, desc: initialSort.desc ?? true }] : [],
  );
  const [query, setQuery] = useState("");
  const { state, hrefFor } = useStateHref();
  const { navigate } = useDashboardNav();
  const hasFlags = rows.some((r) => r.flags?.length);
  // Dentro de um cartão, o CSV sai pelo "Exportar" do cartão; solta na página, a tabela tem o próprio botão.
  const inCard = useInExportCard();
  const csv = useMemo(() => csvTable(columns, rows), [columns, rows]);

  const maxByKey = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of columns) {
      if (c.bar) out[c.key] = Math.max(0, ...rows.map((r) => Number(r.values[c.key]) || 0));
    }
    return out;
  }, [columns, rows]);

  const defs = useMemo<ColumnDef<TableRow>[]>(() => {
    const list: ColumnDef<TableRow>[] = columns.map((c) => ({
      id: c.key,
      // Métrica sem valor vira -Infinity para ir ao fim na ordenação decrescente.
      accessorFn: (r) => r.values[c.key] ?? (c.type === "metric" ? -Infinity : ""),
      header: c.label,
      sortingFn: c.type === "metric" ? "basic" : "alphanumeric",
      sortDescFirst: c.type === "metric",
      cell: ({ row }) => {
        const v = row.original.values[c.key];
        if (c.type === "dim") {
          const text = v === null || v === undefined || v === "" ? "(vazio)" : String(v);
          // Sem link para "(not set)" e vazio, que também ficam fora das opções dos filtros globais.
          return c.filterKey && text !== "(not set)" && text !== "(vazio)" ? (
            <button
              type="button"
              title="Filtrar o painel por este valor"
              onClick={() => navigate(hrefFor({ ...state, filters: { ...state.filters, [c.filterKey!]: [text] } }))}
              className="max-w-[28rem] truncate text-left text-ink underline decoration-line underline-offset-2 hover:decoration-accent"
            >
              {text}
            </button>
          ) : (
            <span className="block max-w-[28rem] truncate text-ink" title={text}>
              {text}
            </span>
          );
        }
        const num = typeof v === "number" ? v : null;
        const prev = row.original.prev?.[c.key];
        return (
          <div className="relative flex flex-col items-end">
            {c.bar && num !== null && maxByKey[c.key] > 0 && (
              <span
                aria-hidden
                className="absolute inset-y-0 right-0 -my-1 rounded-sm bg-accent-wash"
                style={{ width: `${(num / maxByKey[c.key]) * 100}%` }}
              />
            )}
            <span className="relative text-ink">{formatValue(num, c.format ?? "int")}</span>
            {c.delta && num !== null && prev !== undefined && (
              <Delta className="relative" cur={num} prev={prev} better={c.better} />
            )}
          </div>
        );
      },
    }));
    if (hasFlags) {
      list.push({
        id: "__flags",
        header: "Alertas",
        enableSorting: true,
        accessorFn: (r) => r.flags?.length ?? 0,
        sortDescFirst: true,
        cell: ({ row }) => (
          <div className="flex flex-wrap justify-end gap-1">
            {row.original.flags?.map((f) => (
              <Badge key={f.label} tone={f.tone}>
                {f.label}
              </Badge>
            ))}
          </div>
        ),
      });
    }
    return list;
  }, [columns, hasFlags, maxByKey, navigate, hrefFor, state]);

  // Se as colunas mudarem (ex.: outras métricas na exploração), ignora a ordenação por coluna que sumiu.
  const validSorting = useMemo(
    () => sorting.filter((s) => s.id === "__flags" || columns.some((c) => c.key === s.id)),
    [sorting, columns],
  );

  const table = useReactTable({
    data: rows,
    columns: defs,
    state: { sorting: validSorting, globalFilter: query },
    onSortingChange: setSorting,
    onGlobalFilterChange: setQuery,
    globalFilterFn: (row, _col, value: string) =>
      columns
        .filter((c) => c.type === "dim")
        .some((c) => String(row.original.values[c.key] ?? "").toLowerCase().includes(value.toLowerCase())),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const filtered = table.getFilteredRowModel().rows.length;
  const { pageIndex } = table.getState().pagination;

  return (
    // Tabela estreita (poucas colunas) não se espalha pela tela inteira em monitores largos.
    <div className={clsx(columns.length <= 4 && "max-w-[64rem]")}>
      <div
        className={clsx(
          "no-export flex flex-wrap items-center justify-between gap-2",
          !(inCard && !(searchable && rows.length > pageSize)) && "mb-3",
        )}
      >
        {searchable && rows.length > pageSize ? (
          <label className="relative">
            <Search size={14} aria-hidden className="absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
            <input
              type="search"
              placeholder="Buscar"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9 w-64 rounded-full bg-raised pr-3 pl-9 text-sm text-ink placeholder:text-muted"
            />
          </label>
        ) : (
          <span />
        )}
        {inCard ? (
          <ExportData table={csv} />
        ) : (
          <button
            type="button"
            onClick={() => downloadCsv(filename, [csv])}
            className="flex h-8 items-center gap-1.5 rounded-full px-3 text-sm text-ink-2 hover:bg-raised hover:text-ink"
          >
            <Download size={14} aria-hidden /> CSV
          </button>
        )}
      </div>

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-max text-sm tabular">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-line">
                {hg.headers.map((h, i) => {
                  const spec = columns.find((c) => c.key === h.column.id);
                  const sorted = h.column.getIsSorted();
                  const numeric = spec?.type === "metric" || h.column.id === "__flags";
                  return (
                    <th
                      key={h.id}
                      scope="col"
                      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                      className={clsx("py-2 text-xs font-medium text-muted", numeric ? "pl-4 text-right" : "pr-4 text-left", i === 0 && "pl-0")}
                    >
                      <button
                        type="button"
                        onClick={h.column.getToggleSortingHandler()}
                        title={spec?.help}
                        className={clsx("inline-flex items-center gap-1 hover:text-ink", numeric && "flex-row-reverse")}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sorted === "desc" ? (
                          <ArrowDown size={12} aria-hidden />
                        ) : sorted === "asc" ? (
                          <ArrowUp size={12} aria-hidden />
                        ) : (
                          <ArrowUpDown size={12} aria-hidden className="opacity-40" />
                        )}
                      </button>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b border-rule last:border-0 hover:bg-raised">
                {row.getVisibleCells().map((cell, i) => {
                  const spec = columns.find((c) => c.key === cell.column.id);
                  const numeric = spec?.type === "metric" || cell.column.id === "__flags";
                  return (
                    <td key={cell.id} className={clsx("py-2.5 align-top", numeric ? "pl-4 text-right" : "pr-4", i === 0 && "pl-0")}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))}
            {!filtered && (
              <tr>
                <td colSpan={defs.length} className="py-6 text-center text-sm text-muted">
                  Sem dados para este recorte.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {filtered > pageSize && (
        <div className="no-export mt-3 flex items-center justify-end gap-2 text-xs text-ink-2">
          <span className="tabular">
            {pageIndex * pageSize + 1}–{Math.min((pageIndex + 1) * pageSize, filtered)} de {filtered}
          </span>
          <button
            type="button"
            aria-label="Página anterior"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
            className="grid h-8 w-8 place-items-center rounded-full bg-raised hover:bg-active disabled:opacity-40"
          >
            <ChevronLeft size={14} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Próxima página"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
            className="grid h-8 w-8 place-items-center rounded-full bg-raised hover:bg-active disabled:opacity-40"
          >
            <ChevronRight size={14} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}

/** Dados da tabela para o CSV: cada coluna com variação ganha a coluna da comparação ao lado. */
function csvTable(columns: ColumnSpec[], rows: TableRow[]): CsvTable {
  const cols: CsvTable["columns"] = [];
  for (const c of columns) {
    cols.push({ key: c.key, label: c.label, format: c.type === "dim" ? "text" : (c.format ?? "decimal") });
    if (c.delta) cols.push({ key: `${c.key}__prev`, label: `${c.label} (comparação)`, format: c.format ?? "decimal" });
  }
  const flags = rows.some((r) => r.flags?.length);
  if (flags) cols.push({ key: "__flags", label: "Alertas", format: "text" });
  return {
    columns: cols,
    rows: rows.map((r) => {
      const out: CsvTable["rows"][number] = {};
      for (const c of columns) {
        const v = r.values[c.key];
        out[c.key] = c.type === "dim" ? String(v ?? "") : v;
        if (c.delta) out[`${c.key}__prev`] = r.prev?.[c.key];
      }
      if (flags) out.__flags = (r.flags ?? []).map((f) => f.label).join(" | ");
      return out;
    }),
  };
}

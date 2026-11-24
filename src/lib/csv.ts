import type { FormatKind } from "./format";

/**
 * CSV no padrão do Excel brasileiro: separador ";", vírgula decimal e BOM UTF-8.
 * Usado pela tabela e pela exportação de cada visualização (um cartão pode ter mais de uma tabela).
 */

export type CsvColumn = { key: string; label: string; format?: FormatKind | "text" };
export type CsvTable = {
  /** Título da tabela, escrito acima dela quando o arquivo junta mais de uma. */
  title?: string;
  columns: CsvColumn[];
  rows: Record<string, string | number | null | undefined>[];
};

// Casas decimais por formato: tira o ruído de ponto flutuante que o GA4 devolve (ex.: 13489000,000014).
const PLACES: Record<string, number> = { int: 0, brl: 2, duration: 1, decimal: 4, pct: 6 };

function num(v: unknown, format?: string) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "";
  const f = 10 ** (PLACES[format ?? "decimal"] ?? 4);
  return String(Math.round(v * f) / f).replace(".", ",");
}

const esc = (v: string) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function toCsv(tables: CsvTable[]): string {
  const blocks = tables
    .filter((t) => t.columns.length)
    .map((t) => {
      const lines: string[] = [];
      if (t.title && tables.length > 1) lines.push(esc(t.title));
      lines.push(t.columns.map((c) => esc(c.label)).join(";"));
      for (const r of t.rows) {
        lines.push(
          t.columns
            .map((c) => {
              const v = r[c.key];
              if (c.format === "text" || c.format === undefined) {
                return typeof v === "number" ? num(v) : esc(String(v ?? ""));
              }
              return num(v, c.format);
            })
            .join(";"),
        );
      }
      return lines.join("\r\n");
    });
  return `﻿${blocks.join("\r\n\r\n")}`;
}

/** Baixa um arquivo gerado no navegador. */
export function downloadFile(filename: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(filename: string, tables: CsvTable[]) {
  downloadFile(`${filename}.csv`, toCsv(tables), "text/csv;charset=utf-8");
}

/** Nome de arquivo a partir de um título ("Evolução no período" -> "evolucao-no-periodo"). */
export function slugify(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

"use client";

import clsx from "clsx";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";

import { downloadCsv, slugify, type CsvTable } from "@/lib/csv";

import { Popover } from "./Popover";

/**
 * Exportação de cada visualização em separado: o cartão junta os dados que os gráficos e as tabelas
 * de dentro dele registram (CSV) e sabe imprimir só a si mesmo (PDF, pelo "Salvar como PDF" do navegador).
 */

type CardExportContext = {
  register: (id: string, table: CsvTable) => void;
  unregister: (id: string) => void;
  tables: () => CsvTable[];
  count: number;
  section: React.RefObject<HTMLElement | null>;
  name: string;
};

const Ctx = createContext<CardExportContext | null>(null);

/** Está dentro de um cartão com exportação (a tabela esconde o próprio botão de CSV). */
export function useInExportCard() {
  return useContext(Ctx) !== null;
}

/** Entrega os dados de uma visualização ao cartão em volta. Não desenha nada. */
export function ExportData({ table }: { table: CsvTable }) {
  const ctx = useContext(Ctx);
  const id = useId();
  const register = ctx?.register;
  const unregister = ctx?.unregister;
  useEffect(() => {
    register?.(id, table);
  }, [register, id, table]);
  useEffect(() => () => unregister?.(id), [unregister, id]);
  return null;
}

/** Moldura do cartão: guarda os dados registrados e a referência do bloco para o PDF. */
export function CardFrame({
  name,
  className,
  children,
}: {
  /** Título do cartão, usado no nome do arquivo. */
  name?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const section = useRef<HTMLElement>(null);
  const store = useRef(new Map<string, CsvTable>());
  const [count, setCount] = useState(0);
  // Só a entrada e a saída de uma tabela mudam o estado; atualizar os dados não redesenha o cartão.
  const api = useMemo(
    () => ({
      register: (id: string, table: CsvTable) => {
        const isNew = !store.current.has(id);
        store.current.set(id, table);
        if (isNew) setCount(store.current.size);
      },
      unregister: (id: string) => {
        if (store.current.delete(id)) setCount(store.current.size);
      },
      tables: () => [...store.current.values()],
    }),
    [],
  );
  const value = useMemo(() => ({ ...api, count, section, name: name ?? "visualizacao" }), [api, count, name]);
  return (
    <Ctx.Provider value={value}>
      <section ref={section} className={className}>
        {children}
      </section>
    </Ctx.Provider>
  );
}

/** Nome do arquivo: base da página (seção e período, no DashboardShell) mais o título do cartão. */
function fileName(card: string) {
  const base = document.querySelector<HTMLElement>("[data-export-base]")?.dataset.exportBase ?? "cro";
  return `${base}-${slugify(card) || "visualizacao"}`;
}

/** Botão "Exportar" do cabeçalho do cartão: CSV com os dados ou PDF com a imagem da visualização. */
export function ExportMenu() {
  const ctx = useContext(Ctx);
  const [busy, setBusy] = useState(false);
  if (!ctx) return null;

  const item = "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <Popover
      align="right"
      width={260}
      showChevron={false}
      buttonClassName={clsx(
        "no-export no-print flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-sm text-ink-2 transition-colors hover:bg-raised hover:text-ink",
        busy && "opacity-60",
      )}
      label={
        <span className="flex items-center gap-1.5" title="Exportar esta visualização">
          <Download size={14} aria-hidden />
          <span className="hidden sm:inline">{busy ? "Gerando..." : "Exportar"}</span>
        </span>
      }
    >
      {(close) => (
        <div role="menu" aria-label="Exportar esta visualização">
          <button
            type="button"
            role="menuitem"
            disabled={!ctx.count}
            onClick={() => {
              close();
              downloadCsv(fileName(ctx.name), ctx.tables());
            }}
            className={item}
          >
            <FileSpreadsheet size={18} aria-hidden className="mt-0.5 shrink-0 text-accent" />
            <span>
              <span className="block text-sm font-semibold text-ink">CSV</span>
              <span className="block text-xs text-muted">
                {ctx.count ? "Os números desta visualização, para abrir no Excel" : "Esta visualização não tem tabela de dados"}
              </span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={async () => {
              close();
              const el = ctx.section.current;
              if (!el) return;
              setBusy(true);
              try {
                await printSection(el, fileName(ctx.name));
              } finally {
                setBusy(false);
              }
            }}
            className={item}
          >
            <FileText size={18} aria-hidden className="mt-0.5 shrink-0 text-accent" />
            <span>
              <span className="block text-sm font-semibold text-ink">PDF</span>
              <span className="block text-xs text-muted">A visualização como está na tela, pronta para enviar</span>
            </span>
          </button>
        </div>
      )}
    </Popover>
  );
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Imprime só o cartão, num iframe com as mesmas folhas de estilo da página e o resumo do período
 * (propriedade, datas, meta e filtros) no topo. No tema escuro, troca para o claro enquanto copia,
 * para o PDF sair em fundo branco com os gráficos já redesenhados nas cores do claro.
 */
async function printSection(section: HTMLElement, title: string) {
  const root = document.documentElement;
  const savedTheme = root.dataset.theme;
  const dark = savedTheme === "dark" || (savedTheme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  if (dark) {
    root.dataset.theme = "light";
    // Os gráficos ouvem o data-theme e redesenham com animação de 300 ms.
    await wait(700);
  }
  const copy = () => ({
    width: section.getBoundingClientRect().width,
    card: section.cloneNode(true) as HTMLElement,
    summary: (document.querySelector(".export-only")?.cloneNode(true) as HTMLElement | undefined) ?? null,
  });
  let snapshot: ReturnType<typeof copy>;
  try {
    snapshot = copy();
  } finally {
    if (dark) {
      if (savedTheme) root.dataset.theme = savedTheme;
      else delete root.dataset.theme;
    }
  }
  const { width, card, summary } = snapshot;
  card.querySelectorAll(".no-export, .no-print, script").forEach((n) => n.remove());
  card.style.width = `${width}px`;

  const styles = [
    ...[...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map((l) => `<link rel="stylesheet" href="${l.href}">`),
    ...[...document.querySelectorAll("style")].map((s) => s.outerHTML),
  ].join("");
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  // A4 deitado com 12 mm de margem tem cerca de 1030 px úteis: cartões mais largos encolhem por inteiro.
  const zoom = Math.min(1, 1020 / width);

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  if (!win || !doc) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(
    `<!doctype html><html lang="pt-BR" data-theme="light" class="${esc(root.className)}"><head><meta charset="utf-8"><title>${esc(title)}</title>${styles}` +
      `<style>@page{size:A4 landscape;margin:12mm}html,body{background:#fff !important}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}` +
      `.export-only{display:block !important;margin-bottom:16px}.print-wrap{zoom:${zoom}}section{box-shadow:none !important}</style></head>` +
      `<body class="${esc(document.body.className)}"><div class="print-wrap">${summary?.outerHTML ?? ""}${card.outerHTML}</div></body></html>`,
  );
  doc.close();

  // Espera as folhas de estilo e as fontes (até 3 s) antes de abrir a impressão.
  for (let i = 0; i < 60; i++) {
    const links = [...doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')];
    if (doc.readyState === "complete" && links.every((l) => l.sheet)) break;
    await wait(50);
  }
  await doc.fonts?.ready;
  const cleanup = () => setTimeout(() => iframe.remove(), 300);
  win.addEventListener("afterprint", cleanup, { once: true });
  setTimeout(() => iframe.isConnected && iframe.remove(), 120_000);
  win.focus();
  win.print();
}

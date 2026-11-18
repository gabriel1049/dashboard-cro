"use client";

import { FileDown, Printer } from "lucide-react";
import { useState } from "react";

/**
 * As fontes do painel (Montserrat e Raleway, do next/font) entram no arquivo como data URI, para o
 * HTML exportado abrir com a mesma tipografia fora do painel. Só o subconjunto latino (cobre o
 * português); os demais (cirílico, vietnamita, latino estendido) saem para o arquivo não pesar.
 * Se alguma fonte não carregar, o arquivo usa a fonte do sistema.
 */
async function embedFonts(css: string, base: string): Promise<string> {
  const cache = new Map<string, string>();
  const toDataUri = async (raw: string) => {
    const url = new URL(raw, base).href;
    if (!cache.has(url)) {
      const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      cache.set(url, `data:font/woff2;base64,${btoa(bin)}`);
    }
    return cache.get(url)!;
  };

  const blocks = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
  for (const block of blocks) {
    const src = block.match(/url\((["']?)([^"')]+\.woff2)\1\)/);
    if (!src) continue;
    const range = block.match(/unicode-range:([^;}]+)/)?.[1] ?? "";
    let replacement = "";
    // Latino básico: "U+0000-00FF" (ou "U+??", como o minificador escreve).
    if (!range || /U\+(?:0{0,4}-0{0,2}FF|0{0,2}\?\?)(?=[,\s;]|$)/i.test(range)) {
      try {
        replacement = block.replace(src[0], `url(${await toDataUri(src[2])})`);
      } catch {
        replacement = block; // fonte indisponível: o navegador usa a próxima da lista
      }
    }
    css = css.replace(block, replacement);
  }
  return css;
}

/**
 * Exporta a página atual como HTML estático (um arquivo só, com o CSS embutido e os gráficos
 * em SVG) para mandar ao cliente. Filtros e botões saem; o resumo do período entra no lugar.
 */
export function ExportButton({ filename }: { filename: string }) {
  const [busy, setBusy] = useState(false);

  async function exportHtml() {
    setBusy(true);
    try {
      const clone = document.documentElement.cloneNode(true) as HTMLElement;
      clone
        .querySelectorAll('script, noscript, link[rel="preload"], link[rel="modulepreload"], .no-export')
        .forEach((n) => n.remove());
      clone.querySelectorAll("[data-pending]").forEach((n) => n.setAttribute("data-pending", "false"));

      let css = "";
      for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) {
        try {
          css += await embedFonts(await (await fetch(link.href)).text(), link.href);
        } catch {
          /* folha indisponível: segue sem ela */
        }
      }
      clone.querySelectorAll('link[rel="stylesheet"]').forEach((n) => n.remove());
      const style = document.createElement("style");
      // O arquivo é só a folha: sem menu e barra do topo, e sem a rolagem interna do painel.
      style.textContent =
        `${css}\n.export-only{display:block !important}` +
        ".app-frame{display:block !important;height:auto !important;background:var(--frame) !important}" +
        ".sheet{margin:0 auto !important;max-width:1600px;padding-top:32px}";
      clone.querySelector("head")?.appendChild(style);

      const blob = new Blob([`<!doctype html>\n${clone.outerHTML}`], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filename}.html`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="no-export flex items-center gap-2">
      <button
        type="button"
        onClick={exportHtml}
        disabled={busy}
        aria-label="Exportar HTML"
        className="flex h-9 items-center gap-2 rounded-full border border-line bg-surface px-3 text-sm text-ink transition-colors hover:bg-active disabled:opacity-50 sm:px-4"
      >
        <FileDown size={15} aria-hidden /> <span className="hidden sm:inline">{busy ? "Gerando..." : "Exportar HTML"}</span>
      </button>
      <button
        type="button"
        onClick={() => window.print()}
        aria-label="Imprimir ou salvar em PDF"
        title="Imprimir ou salvar em PDF"
        className="hidden size-9 place-items-center rounded-full border border-line bg-surface text-ink transition-colors hover:bg-active sm:grid"
      >
        <Printer size={15} aria-hidden />
      </button>
    </div>
  );
}

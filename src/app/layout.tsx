import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";

import "./globals.css";

// Uma família só, geométrica e neutra, com algarismos bons para tabelas.
const sans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", display: "swap" });

export const metadata: Metadata = {
  title: "Dashboard CRO | Mycon",
  description: "Dashboard de CRO com dados do Google Analytics 4",
  // Painel interno: fora dos buscadores (o robots.ts também bloqueia o rastreamento).
  robots: { index: false, follow: false },
};

/** Aplica o tema salvo antes da primeira pintura (sem piscar claro ao abrir no escuro). */
const THEME_SCRIPT = `try{var t=localStorage.getItem("cro-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

/** Layout raiz de todas as páginas, inclusive o login: fonte, metadados e tema salvo. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  // suppressHydrationWarning: o script de tema muda o data-theme do <html> antes de o React hidratar.
  return (
    <html lang="pt-BR" className={sans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}

"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";

/** Tema em uso: o escolhido no botão (data-theme no <html>) ou, sem escolha, o do sistema. */
function currentTheme(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Alterna claro e escuro. Começa no tema do sistema; a escolha fica salva neste navegador. */
export function ThemeToggle() {
  // No servidor não dá para saber o tema: começa null e lê depois de montar, sem divergir na hidratação.
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => setTheme(currentTheme()), []);

  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => {
        document.documentElement.dataset.theme = next;
        // Mesma chave lida pelo script inline do layout, que aplica o tema antes da primeira pintura.
        // Sem localStorage (aba anônima, armazenamento bloqueado) a troca vale só até recarregar.
        try {
          localStorage.setItem("cro-theme", next);
        } catch {}
        setTheme(next);
      }}
      aria-label={next === "dark" ? "Usar tema escuro" : "Usar tema claro"}
      title={next === "dark" ? "Tema escuro" : "Tema claro"}
      className="grid size-9 place-items-center rounded-full border border-line bg-surface text-ink transition-colors hover:bg-active"
    >
      {theme === "dark" ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
    </button>
  );
}

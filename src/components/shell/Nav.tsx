"use client";

import clsx from "clsx";
import {
  Funnel,
  LayoutDashboard,
  LayoutGrid,
  Megaphone,
  Menu,
  Package,
  Radio,
  ShieldCheck,
  Smartphone,
  Table2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { parseState, serializeState } from "@/lib/state";

/** Navegação entre as seções do painel: menu lateral no desktop e menu sobreposto no celular. */

/** Seções na ordem do briefing (visão macro, perfil, funil, páginas e campanhas, categoria) e, depois, as de apoio. */
export const NAV_GROUPS = [
  {
    title: "Dashboard",
    items: [
      { href: "/", label: "Visão geral", icon: LayoutDashboard },
      { href: "/perfil", label: "Perfil do usuário", icon: UserRound },
      { href: "/funil", label: "Funil de conversão", icon: Funnel },
      { href: "/paginas", label: "Páginas e campanhas", icon: Megaphone },
      { href: "/categorias", label: "Categorias de produto", icon: LayoutGrid },
    ],
  },
  {
    title: "Outras análises",
    items: [
      { href: "/canais", label: "Canais", icon: Radio },
      { href: "/tecnologia", label: "Dispositivo e tecnologia", icon: Smartphone },
      { href: "/produtos", label: "Planos (itens)", icon: Package },
      { href: "/novos-recorrentes", label: "Novos x recorrentes", icon: Users },
      { href: "/qualidade", label: "Qualidade dos dados", icon: ShieldCheck },
      { href: "/explorar", label: "Explorar", icon: Table2 },
    ],
  },
];

/** Todas as seções numa lista só, sem os grupos. */
export const SECTIONS = NAV_GROUPS.flatMap((g) => g.items);

/** Menu de seções. Os links levam o período e os filtros globais, mas não as opções de cada seção. */
export function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  // getAll mantém filtros com vários valores (?canal=A&canal=B). Serializar sem extras descarta os parâmetros da seção atual.
  const query = serializeState(parseState(Object.fromEntries([...new Set(sp.keys())].map((k) => [k, sp.getAll(k)]))));

  return (
    <nav aria-label="Seções" className="flex flex-col gap-6">
      {NAV_GROUPS.map((group) => (
        <div key={group.title}>
          <p className="mb-1.5 px-3 text-xs font-medium text-muted">{group.title}</p>
          <ul className="flex flex-col gap-0.5">
            {group.items.map(({ href, label, icon: Icon }) => {
              // A raiz precisa de comparação exata: com startsWith, "/" ficaria ativa em todas as páginas.
              const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
              return (
                <li key={href}>
                  <Link
                    href={`${href}${query}`}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={clsx(
                      "flex h-10 items-center gap-3 rounded-full px-3.5 text-sm whitespace-nowrap transition-colors",
                      active ? "bg-primary font-semibold text-primary-ink" : "text-ink-2 hover:bg-surface hover:text-ink",
                    )}
                  >
                    <Icon size={17} strokeWidth={active ? 2.25 : 1.75} aria-hidden className="shrink-0" />
                    <span className="truncate">{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** No celular o menu lateral vira um botão na barra do topo que abre as seções por cima da tela. */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // Fecha ao trocar de página e com Esc.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label={open ? "Fechar menu" : "Abrir menu"}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="grid size-9 place-items-center rounded-full border border-line bg-surface text-ink hover:bg-active lg:hidden"
      >
        {open ? <X size={18} aria-hidden /> : <Menu size={18} aria-hidden />}
      </button>
      {open && (
        <div className="fixed inset-x-0 top-16 bottom-0 z-40 overflow-y-auto bg-frame px-3 pt-2 pb-6 lg:hidden">
          <Nav onNavigate={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}

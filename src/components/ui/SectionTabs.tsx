"use client";

import clsx from "clsx";

import { useDashboardNav } from "@/components/shell/PendingProvider";
import { useStateHref } from "@/components/shell/useStateHref";

/** Controle segmentado (no canto do cartão) que troca um parâmetro da seção (ex.: dimensão da tabela) mantendo período e filtros. */
export function SectionTabs({
  param,
  options,
  current,
  label,
}: {
  param: string;
  options: { id: string; label: string }[];
  current: string;
  label: string;
}) {
  const { state, hrefFor } = useStateHref();
  const { navigate } = useDashboardNav();
  // Só este parâmetro muda: as outras opções da seção (ex.: um segundo seletor na mesma página) continuam na URL.
  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex max-w-full overflow-x-auto rounded-full bg-raised p-0.5 [scrollbar-width:none]"
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={o.id === current}
          onClick={() => navigate(hrefFor(state, { [param]: o.id }))}
          className={clsx(
            "h-8 shrink-0 rounded-full border px-3.5 text-sm whitespace-nowrap transition-colors",
            o.id === current ? "border-line bg-surface font-semibold text-ink" : "border-transparent text-ink-2 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

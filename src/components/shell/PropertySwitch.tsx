"use client";

import clsx from "clsx";

import { useDashboardNav } from "./PendingProvider";
import { useStateHref } from "./useStateHref";

/** "Mycon | Site" vira "Site": o nome da marca já está no logotipo ao lado. */
const shortLabel = (label: string) => label.split("|").at(-1)!.trim() || label;

/** Troca de propriedade (Site / App) como controle segmentado na barra do topo. Limpa os filtros de dimensão. */
export function PropertySwitch({
  properties,
  propertyId,
}: {
  properties: { id: string; label: string }[];
  propertyId: string;
}) {
  const { state, hrefFor } = useStateHref();
  const { navigate } = useDashboardNav();
  if (properties.length < 2) return null;

  return (
    <div role="radiogroup" aria-label="Propriedade do GA4" className="flex h-9 items-center rounded-full border border-line bg-surface p-1">
      {properties.map((p) => {
        // Os valores dos filtros (campanhas, versões do app) são de cada propriedade, por isso a troca zera os filtros.
        const on = p.id === propertyId;
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={on}
            title={p.label}
            onClick={() => !on && navigate(hrefFor({ ...state, property: p.id, filters: {} }))}
            className={clsx(
              "h-7 rounded-full px-3.5 text-sm transition-colors",
              on ? "bg-primary font-semibold text-primary-ink" : "text-ink-2 hover:text-ink",
            )}
          >
            {shortLabel(p.label)}
          </button>
        );
      })}
    </div>
  );
}

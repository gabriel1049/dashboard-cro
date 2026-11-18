"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { FILTERS, parseState, serializeState, type DashboardState } from "@/lib/state";

/** Parâmetros que valem para o painel todo. O resto da URL é opção da seção atual (dim, quebra, etapas...). */
const GLOBAL_KEYS = new Set<string>(["p", "periodo", "de", "ate", "comparar", "meta", ...FILTERS.map((f) => f.key)]);

/** Estado atual da URL + gerador de links que troca o estado global e preserva as opções da seção. */
export function useStateHref() {
  const pathname = usePathname();
  const sp = useSearchParams();

  // getAll porque filtro com vários valores repete a chave na URL (?canal=A&canal=B).
  const state = useMemo(
    () => parseState(Object.fromEntries([...new Set(sp.keys())].map((k) => [k, sp.getAll(k)]))),
    [sp],
  );

  const sectionParams = useMemo(() => {
    const out: Record<string, string> = {};
    for (const k of new Set(sp.keys())) if (!GLOBAL_KEYS.has(k)) out[k] = sp.get(k) ?? "";
    return out;
  }, [sp]);

  // As chaves de `section` sobrescrevem as da URL; valor undefined ou vazio tira o parâmetro.
  const hrefFor = useCallback(
    (next: DashboardState, section?: Record<string, string | undefined>) =>
      `${pathname}${serializeState(next, { ...sectionParams, ...section })}`,
    [pathname, sectionParams],
  );

  return { state, hrefFor, pathname, sectionParams };
}

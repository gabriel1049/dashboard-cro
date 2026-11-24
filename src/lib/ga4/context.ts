import "server-only";

import {
  addDays,
  FILTERS,
  parseState,
  resolveRanges,
  todayIn,
  type DashboardState,
  type FilterKey,
  type SearchParams,
} from "../state";
import { cached } from "./cache";
import { getProperties, getTimeZone, resolvePropertyId, type PropertyOption } from "./config";
import { runReport, type QueryContext } from "./report";

/** Ponte entre a URL e as consultas: o estado da página vira o QueryContext que runReport recebe. */

/** O que cada página recebe: estado da URL, contexto de consulta e as propriedades disponíveis. */
export type PageContext = {
  state: DashboardState;
  ctx: QueryContext;
  properties: PropertyOption[];
  propertyLabel: string;
};

/** Lê os searchParams da página e monta o contexto de consulta (propriedade, períodos, filtros). */
export function buildContext(sp: SearchParams): PageContext {
  const state = parseState(sp);
  const properties = getProperties();
  const propertyId = resolvePropertyId(state.property);
  // "Hoje" no fuso da propriedade, o mesmo que o GA4 usa para fechar os dias.
  const today = todayIn(getTimeZone(propertyId));
  const { current, comparison } = resolveRanges(state, today);
  const filters = FILTERS.filter((f) => state.filters[f.key]?.length).map((f) => ({
    dimension: f.dimension,
    values: state.filters[f.key]!,
  }));
  return {
    state,
    ctx: { propertyId, current, comparison, filters, today, goal: state.goal },
    properties,
    propertyLabel: properties.find((p) => p.id === propertyId)?.label ?? propertyId,
  };
}

export type FilterOptions = Partial<Record<FilterKey, string[]>>;

/** Valores disponíveis para cada filtro global (últimos 90 dias, sem filtros aplicados). */
export function getFilterOptions(ctx: QueryContext): Promise<FilterOptions> {
  return cached(`options3:${ctx.propertyId}:${ctx.today}`, 3 * 3600_000, async () => {
    const range = { start: addDays(ctx.today, -90), end: addDays(ctx.today, -1) };
    const entries = await Promise.all(
      FILTERS.map(async (f) => {
        try {
          const r = await runReport(ctx, {
            dimensions: [f.dimension],
            metrics: ["sessions"],
            globalFilters: false,
            range,
            orderBy: { metric: "sessions" },
            // Campanhas e origens passam de cem valores; a lista do filtro tem busca.
            limit: f.key === "campanha" || f.key === "origem" ? 250 : 60,
          });
          const values = r.rows
            .map((row) => row.dims[f.dimension])
            .filter((v) => v && v !== "(not set)" && v !== "(other)");
          return [f.key, values] as const;
        } catch {
          // Erro numa dimensão só tira aquele filtro da barra; os outros continuam.
          return [f.key, []] as const;
        }
      }),
    );
    // Filtro com um valor só não filtra nada (ex.: plataforma num site só web).
    return Object.fromEntries(entries.filter(([, v]) => v.length > 1));
  });
}

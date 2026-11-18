import "server-only";

import type { ColumnSpec, TableRow } from "@/components/table/DataTable";
import type { Tone } from "@/components/ui/primitives";
import { FUNNEL_PRESETS } from "@/config/cro";

import { addDays } from "./state";
import { cached } from "./ga4/cache";
import type { FunnelStepDef } from "./ga4/funnel";
import { eventInventory, type Cro, type Terms } from "./ga4/kpis";
import type { QueryContext } from "./ga4/report";
import type { FilterKey } from "./state";

/**
 * Peças comuns às páginas: colunas e linhas CRO das tabelas, o inventário de eventos e o
 * funil padrão, montado só com eventos que existem na propriedade.
 */

/**
 * Colunas CRO padrão (sessões, conversão e contagem da meta, receita, ticket), com variação.
 * Na meta "lead" saem receita e ticket, que são do purchase.
 */
export function croColumns(
  terms: Terms,
  dim: { key: string; label: string; filterKey?: FilterKey },
  opts: { engagement?: boolean } = {},
): ColumnSpec[] {
  return [
    { key: dim.key, label: dim.label, type: "dim", filterKey: dim.filterKey },
    { key: "sessions", label: "Sessões", type: "metric", format: "int", bar: true, delta: true },
    { key: "users", label: "Usuários", type: "metric", format: "int" },
    ...(opts.engagement === false
      ? []
      : [{ key: "engagementRate", label: "Engajamento", type: "metric", format: "pct", delta: true } as ColumnSpec]),
    {
      key: "conversion",
      label: terms.conversion,
      type: "metric",
      format: "pct",
      delta: true,
      help: terms.conversionHelp,
    },
    { key: "goals", label: terms.goal, type: "metric", format: "int", delta: true },
    ...(terms.lead
      ? []
      : ([
          { key: "revenue", label: terms.revenue, type: "metric", format: "brl", delta: true },
          { key: "ticket", label: terms.ticket, type: "metric", format: "brl" },
        ] as ColumnSpec[])),
  ];
}

/** Linha para as colunas de croColumns, com os valores do período atual e os da comparação. */
export function croRow(
  id: string,
  dimKey: string,
  value: string,
  cur: Cro,
  prev?: Cro,
  flags?: { label: string; tone: Tone }[],
): TableRow {
  const pick = (c: Cro) => ({
    sessions: c.sessions,
    users: c.users,
    engagementRate: c.engagementRate,
    conversion: c.conversion,
    goals: c.goals,
    revenue: c.revenue,
    ticket: c.ticket,
  });
  return { id, values: { [dimKey]: value, ...pick(cur) }, prev: prev ? pick(prev) : undefined, flags };
}

/** Inventário dos últimos 90 dias (estável, independente do período escolhido). */
export function inventory90(ctx: QueryContext) {
  // Termina ontem: o dia corrente ainda está incompleto no GA4.
  return cached(`inv90:${ctx.propertyId}:${ctx.today}`, 3 * 3600_000, () =>
    eventInventory(ctx, { start: addDays(ctx.today, -90), end: addDays(ctx.today, -1) }),
  );
}

/** Mantém só as etapas cujo evento existe na propriedade; devolve também as removidas. */
export async function activeSteps(ctx: QueryContext, steps: FunnelStepDef[]) {
  const inv = await inventory90(ctx);
  const present = new Set(inv.filter((e) => e.count > 0).map((e) => e.event));
  return {
    steps: steps.filter((s) => present.has(s.event)),
    removed: steps.filter((s) => !present.has(s.event)),
  };
}

/** Funil padrão da propriedade: o candidato de FUNNEL_PRESETS com a maior parte dos eventos presentes. */
export async function defaultFunnel(ctx: QueryContext): Promise<{ steps: FunnelStepDef[]; removed: FunnelStepDef[] }> {
  try {
    const inv = await inventory90(ctx);
    const present = new Set(inv.filter((e) => e.count > 0).map((e) => e.event));
    const share = (p: FunnelStepDef[]) => p.filter((s) => present.has(s.event)).length / p.length;
    // Em empate fica o candidato que vem antes em FUNNEL_PRESETS.
    const best = FUNNEL_PRESETS.reduce((a, b) => (share(b) > share(a) ? b : a));
    return {
      steps: best.filter((s) => present.has(s.event)),
      removed: best.filter((s) => !present.has(s.event)),
    };
  } catch {
    // Sem inventário (erro ou cota do GA4), usa o primeiro candidato inteiro.
    return { steps: FUNNEL_PRESETS[0], removed: [] };
  }
}

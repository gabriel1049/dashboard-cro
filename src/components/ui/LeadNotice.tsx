import { leadKeyEventStart } from "@/lib/ga4/kpis";
import type { QueryContext } from "@/lib/ga4/report";

import { Notice } from "./primitives";

const br = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Meta "lead": avisa quando o período atual ou o de comparação começa antes de o lead virar evento-chave.
 * Antes dessa data o GA4 mostra zero (não recalcula para trás), e a variação fica sem base.
 */
export async function LeadCoverageNotice({ ctx }: { ctx: QueryContext }) {
  const start = await leadKeyEventStart(ctx).catch(() => null);
  if (!start) return null;
  const currentCut = ctx.current.start < start;
  const comparisonCut = Boolean(ctx.comparison && ctx.comparison.start < start);
  if (!currentCut && !comparisonCut) return null;
  const parts = [
    ...(currentCut ? ["o período atual tem dias zerados"] : []),
    ...(comparisonCut
      ? [ctx.comparison!.end < start ? "a comparação fica sem base" : "a comparação tem dias zerados e a variação sai inflada"]
      : []),
  ];
  const what = parts.join(" e ");
  return (
    <Notice tone="warning" title={`Leads só contam como evento-chave desde ${br(start)}`}>
      O GA4 não recalcula eventos-chave para trás: antes dessa data, taxa de lead e leads aparecem como zero, então {what}. Para
      comparar leads, use períodos a partir de {br(start)}.
    </Notice>
  );
}

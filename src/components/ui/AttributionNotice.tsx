import { Suspense } from "react";

import { fmtInt, fmtPct } from "@/lib/format";
import { leadAvailable } from "@/lib/ga4/kpis";
import { settle, type QueryContext } from "@/lib/ga4/report";
import { ATTRIBUTION_ALERT, purchaseAttribution } from "@/lib/quality";

import { GoalButton } from "./GoalButton";
import { LeadCoverageNotice } from "./LeadNotice";
import { Notice } from "./primitives";

/**
 * Aviso para telas que quebram a conversão por segmento (canal, dispositivo, página, tipo de usuário):
 * se a maior parte das compras chega sem origem, todos os segmentos aparecem com conversão menor que a real.
 * Só vale para a meta "compra"; na meta "lead" a conversão não depende do purchase, e o aviso dá lugar
 * ao de cobertura do lead (desde quando ele é evento-chave).
 */
export async function AttributionNotice({ ctx, what }: { ctx: QueryContext; what: string }) {
  const lead = await leadAvailable(ctx.propertyId).catch(() => false);
  if (ctx.goal === "lead" && lead) return <LeadCoverageNotice ctx={ctx} />;
  const res = await settle(purchaseAttribution(ctx));
  if (!res.ok || res.data.total < 20 || res.data.share < ATTRIBUTION_ALERT) return null;
  const a = res.data;
  return (
    <Notice tone="critical" title={`${fmtPct(a.share, 0)} das compras chegam sem origem`}>
      {fmtInt(a.unattributed)} de {fmtInt(a.total)} compras do período não têm canal, página nem dispositivo (o GA4 as mostra
      como &quot;Unassigned&quot;). Por isso a conversão por {what} aparece menor que a real em todos os segmentos. Compare os
      segmentos entre si e prefira as etapas antes da compra. Detalhes em Qualidade dos dados.
      {lead && (
        <>
          {" "}
          A meta Lead não depende do purchase e mostra a conversão por {what} sem essa distorção.
          <span className="block">
            <Suspense>
              <GoalButton goal="lead">Ver por lead</GoalButton>
            </Suspense>
          </span>
        </>
      )}
    </Notice>
  );
}

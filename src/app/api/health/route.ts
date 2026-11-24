import { buildContext } from "@/lib/ga4/context";
import { runFunnel } from "@/lib/ga4/funnel";
import { runReport, settle } from "@/lib/ga4/report";

// Diagnóstico sempre ao vivo: nunca uma resposta gerada no build ou guardada em cache.
export const dynamic = "force-dynamic";

/** Diagnóstico da conexão com o GA4. Em produção só responde se está ok, sem dados. */
export async function GET() {
  // Contexto padrão (propriedade e período default, sem filtros) e uma consulta pequena de teste.
  const { ctx, propertyLabel } = buildContext({});
  const report = await settle(
    runReport(ctx, {
      dimensions: ["platform"],
      metrics: ["sessions", "sessionKeyEventRate:purchase"],
      totals: true,
    }),
  );
  if (process.env.NODE_ENV === "production") {
    return Response.json({ ok: report.ok, error: report.ok ? undefined : report.error });
  }
  // Fora de produção também testa o runFunnelReport com um funil de e-commerce padrão e devolve tudo.
  const funnel = await settle(
    runFunnel(
      ctx,
      [
        { label: "Ver plano", event: "view_item" },
        { label: "Checkout", event: "begin_checkout" },
        { label: "Compra", event: "purchase" },
      ],
      { breakdown: "platform" },
    ),
  );
  return Response.json({ propertyLabel, ctx, report, funnel });
}

import "server-only";

import { BetaAnalyticsDataClient, v1alpha } from "@google-analytics/data";

import { loadCredentials } from "./config";

/** Clientes da Data API (v1beta e v1alpha), criados uma vez por processo com a credencial de loadCredentials. */

type Clients = { beta: BetaAnalyticsDataClient; alpha: v1alpha.AlphaAnalyticsDataClient };

// Guardado no globalThis para o hot reload do `next dev` não abrir uma conexão gRPC nova a cada edição.
const g = globalThis as typeof globalThis & { __ga4Clients?: Clients };

function clients(): Clients {
  if (!g.__ga4Clients) {
    const { credentials } = loadCredentials();
    // GA4_API_TRANSPORT=rest troca o gRPC por HTTP/1.1 + JSON, para hospedagens que bloqueiam o gRPC.
    const fallback = process.env.GA4_API_TRANSPORT?.trim().toLowerCase() === "rest";
    g.__ga4Clients = {
      beta: new BetaAnalyticsDataClient({ credentials, fallback }),
      alpha: new v1alpha.AlphaAnalyticsDataClient({ credentials, fallback }),
    };
  }
  return g.__ga4Clients;
}

/** v1beta: runReport, getMetadata. */
export const betaClient = () => clients().beta;

/** v1alpha: runFunnelReport. */
export const alphaClient = () => clients().alpha;

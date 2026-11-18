import "server-only";

import { cached } from "./cache";
import { betaClient } from "./client";
import { Ga4Error, toGa4Error } from "./errors";

/**
 * Dimensões e métricas da propriedade, inclusive as personalizadas. As consultas validam os
 * nomes aqui antes de ir ao GA4, para um erro de digitação virar mensagem clara e não erro da API.
 */

/** Campo do getMetadata. type só vem nas métricas (ex.: TYPE_CURRENCY). */
export type FieldInfo = { apiName: string; uiName: string; category: string; custom: boolean; type?: string };
export type Metadata = { dimensions: Map<string, FieldInfo>; metrics: Map<string, FieldInfo> };

// Com este cache, uma dimensão ou métrica personalizada recém-criada leva até 12 horas para aparecer no painel.
const TWELVE_HOURS = 12 * 3600_000;

/** getMetadata da propriedade: a fonte da verdade para nomes de dimensões e métricas. */
export function getMetadata(propertyId: string): Promise<Metadata> {
  return cached(`metadata:${propertyId}`, TWELVE_HOURS, async () => {
    try {
      const [md] = await betaClient().getMetadata({ name: `properties/${propertyId}/metadata` });
      const toInfo = (f: {
        apiName?: string | null;
        uiName?: string | null;
        category?: string | null;
        customDefinition?: boolean | null;
        type?: unknown;
      }): FieldInfo => ({
        apiName: f.apiName ?? "",
        uiName: f.uiName ?? f.apiName ?? "",
        category: f.category ?? "",
        custom: Boolean(f.customDefinition),
        type: f.type ? String(f.type) : undefined,
      });
      return {
        dimensions: new Map((md.dimensions ?? []).map((d) => [d.apiName ?? "", toInfo(d)])),
        metrics: new Map((md.metrics ?? []).map((m) => [m.apiName ?? "", toInfo(m)])),
      };
    } catch (err) {
      throw toGa4Error(err);
    }
  });
}

/** Garante que todos os nomes existem na propriedade antes de consultar (nada "de cabeça"). */
export async function assertFields(propertyId: string, dimensions: string[], metrics: string[]) {
  const md = await getMetadata(propertyId);
  const missing = [
    ...dimensions.filter((d) => !md.dimensions.has(d)).map((d) => `dimensão ${d}`),
    ...metrics.filter((m) => !md.metrics.has(m)).map((m) => `métrica ${m}`),
  ];
  if (missing.length) {
    throw new Ga4Error(`Não existe nesta propriedade do GA4: ${missing.join(", ")}.`);
  }
}

/** Diz se a métrica existe na propriedade, sem lançar erro como assertFields. */
export async function hasMetric(propertyId: string, name: string) {
  return (await getMetadata(propertyId)).metrics.has(name);
}

/** O mesmo que hasMetric, para dimensões. */
export async function hasDimension(propertyId: string, name: string) {
  return (await getMetadata(propertyId)).dimensions.has(name);
}

import "server-only";

/** Tradução dos erros da Data API para mensagens em português, com o que fazer em cada caso. */

/** Erro do GA4 com mensagem em português pronta para mostrar no painel. */
export class Ga4Error extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "Ga4Error";
  }
}

/** Converte qualquer erro da consulta num Ga4Error. O texto original da API fica em detail. */
export function toGa4Error(err: unknown): Ga4Error {
  if (err instanceof Ga4Error) return err;
  const e = err as { code?: number; details?: string; message?: string };
  const detail = e?.details || e?.message || String(err);
  // Códigos de status do gRPC: 3 INVALID_ARGUMENT, 7 PERMISSION_DENIED, 8 RESOURCE_EXHAUSTED, 16 UNAUTHENTICATED.

  if (/invalid_grant|unauthorized_client/i.test(detail) || e?.code === 16) {
    return new Ga4Error(
      "O login do Google expirou ou foi revogado. Rode `python -m ga4cro login` na pasta lab/ e recarregue.",
      detail,
    );
  }
  // Antes do código 7: API desativada no projeto também chega como PERMISSION_DENIED.
  if (/SERVICE_DISABLED|has not been used in project/i.test(detail)) {
    return new Ga4Error("A Google Analytics Data API não está ativada no projeto do Google Cloud.", detail);
  }
  if (e?.code === 7) {
    return new Ga4Error("A credencial configurada não tem acesso a esta propriedade do GA4.", detail);
  }
  if (e?.code === 8) {
    return new Ga4Error("A cota da API do GA4 acabou por agora. Os dados voltam na próxima hora.", detail);
  }
  if (e?.code === 3 && /incompatible/i.test(detail)) {
    return new Ga4Error(
      "O GA4 não permite combinar estes campos ou filtros (por exemplo, canal da sessão com dados de produto). Troque um campo ou remova algum filtro para ver este bloco.",
      detail,
    );
  }
  return new Ga4Error(`Erro do GA4: ${detail}`, detail);
}

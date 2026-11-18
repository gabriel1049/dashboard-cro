import "server-only";

import fs from "node:fs";
import path from "node:path";

/**
 * Configuração lida do .env (o mesmo usado pelo laboratório Python em lab/).
 *
 * Credenciais, em ordem de prioridade:
 * 1. Service Account: GA4_SERVICE_ACCOUNT_JSON (conteúdo JSON ou base64) ou GA4_SERVICE_ACCOUNT_FILE
 * 2. OAuth: GA4_OAUTH_CLIENT_ID + GA4_OAUTH_CLIENT_SECRET + GA4_OAUTH_REFRESH_TOKEN (ideal no servidor)
 *    ou o arquivo GA4_OAUTH_TOKEN_FILE gerado por `python -m ga4cro login` (padrão em desenvolvimento)
 */

export type PropertyOption = { id: string; label: string; timeZone?: string };

export type CredentialInput = {
  type?: string;
  client_email?: string;
  private_key?: string;
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
};

const ROOT = process.cwd();

function readJsonFile(file: string | undefined): Record<string, unknown> | null {
  if (!file) return null;
  // Arquivo lido em tempo de execução (credenciais locais): não deve entrar no bundle do build.
  const full = path.isAbsolute(file) ? file : path.join(/*turbopackIgnore: true*/ ROOT, file);
  if (!fs.existsSync(full)) return null;
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

function isTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function parseJsonEnv(value: string | undefined): Record<string, unknown> | null {
  if (!value?.trim()) return null;
  const raw = value.trim().startsWith("{") ? value : Buffer.from(value, "base64").toString("utf8");
  return JSON.parse(raw);
}

export function getProperties(): PropertyOption[] {
  // GA4_PROPERTIES="314161581=Mycon | Site|America/Sao_Paulo;469824674=Mycon | App|America/Rio_Branco"
  // (opcional, para várias propriedades; o fuso depois do "|" é opcional e vale só para aquela propriedade)
  const list = (process.env.GA4_PROPERTIES ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [id, ...rest] = item.split("=");
      const value = rest.join("=");
      // O nome pode ter "|" (ex.: "Mycon | Site"): só o último trecho no formato Região/Cidade é fuso.
      const m = value.match(/^(.*)\|\s*([A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+)\s*$/);
      const timeZone = m && isTimeZone(m[2]) ? m[2] : undefined;
      const label = (timeZone ? m![1] : value).trim();
      return { id: id.trim(), label: label || id.trim(), timeZone };
    })
    .filter((p) => /^\d+$/.test(p.id));
  if (list.length) return list;
  const id = (process.env.GA4_PROPERTY_ID ?? "").trim();
  if (!/^\d+$/.test(id)) {
    throw new Error("GA4_PROPERTY_ID ausente ou inválido no .env (use só os números da propriedade).");
  }
  return [{ id, label: process.env.GA4_PROPERTY_LABEL?.trim() || `Propriedade ${id}` }];
}

/** Só aceita propriedades configuradas no .env: a URL não consegue consultar outras. */
export function resolvePropertyId(requested?: string): string {
  const props = getProperties();
  return props.find((p) => p.id === requested)?.id ?? props[0].id;
}

/** Fuso da propriedade (define o que é "ontem"): o do GA4_PROPERTIES, senão GA4_TIME_ZONE. */
export function getTimeZone(propertyId?: string): string {
  const own = propertyId ? getProperties().find((p) => p.id === propertyId)?.timeZone : undefined;
  return own || process.env.GA4_TIME_ZONE?.trim() || "America/Sao_Paulo";
}

export function loadCredentials(): { kind: "service_account" | "oauth"; credentials: CredentialInput } {
  const mode = (process.env.GA4_AUTH_MODE ?? "auto").trim().toLowerCase();

  if (mode !== "oauth") {
    const sa =
      parseJsonEnv(process.env.GA4_SERVICE_ACCOUNT_JSON) ?? readJsonFile(process.env.GA4_SERVICE_ACCOUNT_FILE);
    if (sa) {
      return {
        kind: "service_account",
        credentials: { client_email: String(sa.client_email), private_key: String(sa.private_key) },
      };
    }
    if (mode === "service_account") {
      throw new Error("GA4_AUTH_MODE=service_account, mas a chave da Service Account não foi encontrada.");
    }
  }

  const fromEnv = {
    client_id: process.env.GA4_OAUTH_CLIENT_ID,
    client_secret: process.env.GA4_OAUTH_CLIENT_SECRET,
    refresh_token: process.env.GA4_OAUTH_REFRESH_TOKEN,
  };
  const token = fromEnv.refresh_token
    ? fromEnv
    : readJsonFile(process.env.GA4_OAUTH_TOKEN_FILE ?? "credentials/token.json");

  if (!token?.refresh_token || !token.client_id || !token.client_secret) {
    throw new Error(
      "Credencial do GA4 não encontrada. Rode `python -m ga4cro login` (pasta lab/) para gerar credentials/token.json, " +
        "ou defina GA4_OAUTH_CLIENT_ID, GA4_OAUTH_CLIENT_SECRET e GA4_OAUTH_REFRESH_TOKEN.",
    );
  }
  return {
    kind: "oauth",
    credentials: {
      type: "authorized_user",
      client_id: String(token.client_id),
      client_secret: String(token.client_secret),
      refresh_token: String(token.refresh_token),
    },
  };
}

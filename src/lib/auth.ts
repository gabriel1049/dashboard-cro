/**
 * Acesso ao painel: uma senha compartilhada (DASHBOARD_PASSWORD) vira um cookie de sessão assinado
 * com HMAC-SHA256. A chave vem de DASHBOARD_SECRET (ou da própria senha, se não houver segredo):
 * trocar qualquer um dos dois derruba todas as sessões abertas.
 *
 * Sem senha configurada, o login fica desligado em desenvolvimento e fechado em produção
 * (ninguém entra), para um deploy esquecido não expor os dados do GA4.
 *
 * Usa só Web Crypto, então serve tanto no proxy quanto nas server actions.
 */

export const SESSION_COOKIE = "cro_session";
export const SESSION_DAYS = 14;

const enc = new TextEncoder();

export type AuthMode = "on" | "off" | "misconfigured";

export function authMode(): AuthMode {
  if (process.env.DASHBOARD_PASSWORD?.trim()) return "on";
  return process.env.NODE_ENV === "production" ? "misconfigured" : "off";
}

async function sign(data: string): Promise<string> {
  const secret = process.env.DASHBOARD_SECRET?.trim() || process.env.DASHBOARD_PASSWORD?.trim() || "";
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(`cro-dashboard:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return Buffer.from(await crypto.subtle.sign("HMAC", key, enc.encode(data))).toString("base64url");
}

/** Comparação em tempo constante (não para no primeiro caractere diferente). */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function checkPassword(input: string): Promise<boolean> {
  const expected = process.env.DASHBOARD_PASSWORD?.trim();
  if (!expected || !input) return false;
  // Compara as assinaturas (mesmo tamanho), não as senhas: não vaza o tamanho da senha certa.
  return same(await sign(`pw:${input}`), await sign(`pw:${expected}`));
}

export async function createSession(): Promise<{ value: string; maxAge: number }> {
  const maxAge = SESSION_DAYS * 24 * 3600;
  const exp = Math.floor(Date.now() / 1000) + maxAge;
  return { value: `${exp}.${await sign(`session:${exp}`)}`, maxAge };
}

export async function verifySession(value: string | undefined): Promise<boolean> {
  if (authMode() !== "on" || !value) return false;
  const [expRaw, sig] = value.split(".");
  const exp = Number(expRaw);
  if (!Number.isInteger(exp) || exp * 1000 < Date.now() || !sig) return false;
  return same(sig, await sign(`session:${exp}`));
}

/** Destino depois do login: só caminhos do próprio painel (nada de "//outro-site.com"). */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (next === "/login" || next.startsWith("/login?") || next.startsWith("/logout")) return "/";
  return next;
}

// Proxy do Next 16 (o antigo middleware): roda antes de toda rota que casa com o matcher no fim do arquivo.
import { NextResponse, type NextRequest } from "next/server";

import { authMode, SESSION_COOKIE, verifySession } from "@/lib/auth";

/** Rotas abertas sem sessão: a própria tela de login e a saída. */
const PUBLIC = new Set(["/login", "/logout"]);

/**
 * Todo o painel exige sessão. Sem ela, páginas vão para /login (guardando o destino) e a API
 * responde 401.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const mode = authMode();
  if (mode === "off" || PUBLIC.has(pathname)) return NextResponse.next();
  if (mode === "on" && (await verifySession(request.cookies.get(SESSION_COOKIE)?.value))) return NextResponse.next();

  // Daqui para baixo não há sessão válida. Em "misconfigured" ninguém passa: tudo cai no login,
  // que explica o que falta configurar.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Acesso restrito. Entre no painel primeiro." }, { status: 401 });
  }
  const target = pathname + search;
  const location = target === "/" ? "/login" : `/login?next=${encodeURIComponent(target)}`;
  // O Next exige URL absoluta aqui e devolve o Location relativo quando a origem é a mesma.
  const res = NextResponse.redirect(new URL(location, request.url), 307);
  // Sem cache: o redirecionamento não pode ser reaproveitado depois que a pessoa entrar.
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export const config = {
  // Arquivos estáticos do build, ícone e robots.txt ficam fora (não têm dado nenhum).
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico|robots.txt).*)"],
};

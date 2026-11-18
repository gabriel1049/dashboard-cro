import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { MyconLogo } from "@/components/shell/MyconLogo";
import { authMode, checkPassword, createSession, safeNext, SESSION_COOKIE, verifySession } from "@/lib/auth";

export const metadata: Metadata = { title: "Entrar | Dashboard CRO" };

type SP = Promise<Record<string, string | string[] | undefined>>;
/** Primeiro valor de um parâmetro da URL. */
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Server action do formulário: confere a senha, grava o cookie de sessão e volta para a página pedida. */
async function login(formData: FormData) {
  "use server";
  // O destino vem do formulário, então passa de novo pelo safeNext (só caminhos do próprio painel).
  const next = safeNext(String(formData.get("next") ?? "/"));
  if (!(await checkPassword(String(formData.get("senha") ?? "")))) {
    // Atraso fixo a cada erro: deixa tentativa em massa lenta sem bloquear quem errou uma vez.
    await new Promise((r) => setTimeout(r, 800));
    redirect(`/login?erro=1${next === "/" ? "" : `&next=${encodeURIComponent(next)}`}`);
  }
  const { value, maxAge } = await createSession();
  // Cookie só para o servidor; exige https apenas em produção, porque o dev local roda em http.
  (await cookies()).set(SESSION_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  redirect(next);
}

/**
 * Tela de login: senha única do painel, que vira um cookie de sessão assinado (lib/auth). Com o
 * login desligado ou com sessão válida, segue direto para o destino pedido.
 */
export default async function LoginPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const next = safeNext(one(sp.next));
  const mode = authMode();
  if (mode === "off") redirect(next);
  if (await verifySession((await cookies()).get(SESSION_COOKIE)?.value)) redirect(next);
  const error = one(sp.erro) === "1";

  // "misconfigured" é produção sem DASHBOARD_PASSWORD: no lugar do formulário, explica o que falta.
  return (
    <main className="grid min-h-dvh place-items-center bg-frame px-4 py-10">
      <div className="w-full max-w-[25rem]">
        <div className="mb-8 flex items-center justify-center gap-2.5" aria-label="Mycon, Dashboard CRO">
          <MyconLogo className="h-[24px] w-auto text-ink" />
          <span className="h-4 w-px bg-control" aria-hidden />
          <span className="text-sm font-bold tracking-tight text-ink">CRO</span>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8">
          <h1 className="text-xl font-bold tracking-[-0.02em] text-ink">Entrar no painel</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
            Dados do Google Analytics 4 da Mycon. Acesso restrito à equipe do projeto.
          </p>

          {mode === "misconfigured" ? (
            <p className="mt-6 rounded-xl bg-warning/10 px-4 py-3 text-sm leading-relaxed text-ink-2">
              O acesso ainda não foi configurado neste servidor. Defina a variável DASHBOARD_PASSWORD na hospedagem e
              reinicie o app.
            </p>
          ) : (
            <form action={login} className="mt-6">
              <input type="hidden" name="next" value={next} />
              {/* Nome fixo para o gerenciador de senhas guardar a senha com um rótulo. */}
              <input type="text" name="usuario" value="Dashboard CRO Mycon" autoComplete="username" readOnly hidden />
              <label htmlFor="senha" className="text-sm font-medium text-ink">
                Senha
              </label>
              <input
                id="senha"
                name="senha"
                type="password"
                required
                autoFocus
                autoComplete="current-password"
                aria-invalid={error || undefined}
                aria-describedby={error ? "senha-erro" : undefined}
                className="mt-1.5 block h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-[0.9375rem] text-ink transition-colors outline-none focus:border-accent focus:ring-2 focus:ring-accent/25 aria-invalid:border-critical"
              />
              {error && (
                <p id="senha-erro" role="alert" className="mt-2 text-sm text-critical-ink">
                  Senha incorreta. Confira e tente de novo.
                </p>
              )}
              <button
                type="submit"
                className="mt-5 h-11 w-full rounded-full bg-primary text-sm font-semibold text-primary-ink transition-colors hover:bg-primary-hover"
              >
                Entrar
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted">Google Analytics 4, somente leitura</p>
      </div>
    </main>
  );
}

import type { Metadata } from "next";
import Link from "next/link";

import { MyconLogo } from "@/components/shell/MyconLogo";

export const metadata: Metadata = { title: "Privacidade | Dashboard CRO" };

/** Blocos da política: título curto e um parágrafo cada. */
const SECTIONS: { title: string; body: React.ReactNode }[] = [
  {
    title: "O que o painel acessa",
    body: (
      <>
        Com a autorização da conta Google, o painel lê relatórios do Google Analytics 4 com a permissão &quot;Ver e
        baixar os dados do Google Analytics&quot; (escopo <code>analytics.readonly</code>). Ele não altera nada na conta
        do Analytics e não pede acesso a e-mail, contatos, arquivos ou qualquer outro serviço do Google.
      </>
    ),
  },
  {
    title: "Como os dados são usados",
    body: (
      <>
        Os relatórios servem só para montar os gráficos e as tabelas do painel. Os números chegam agregados do GA4
        (sessões, eventos e conversões por canal, página, dispositivo e afins), sem identificar quem visitou o site.
        Ficam num cache temporário na memória do servidor, por no máximo 12 horas, e não são gravados em banco de
        dados, vendidos nem repassados a terceiros.
      </>
    ),
  },
  {
    title: "Credenciais",
    body: (
      <>
        A autorização do Google fica guardada em variáveis de ambiente do servidor, fora do código e do navegador.
        Quem usa o painel nunca recebe essa credencial.
      </>
    ),
  },
  {
    title: "Cookies e armazenamento no navegador",
    body: (
      <>
        O painel usa um único cookie, de sessão, para lembrar que a pessoa entrou com a senha. Ele dura até 14 dias e
        não serve para rastreamento. A escolha de tema claro ou escuro fica salva no próprio navegador. O painel não
        tem ferramentas de analytics nem de publicidade.
      </>
    ),
  },
  {
    title: "Uso limitado",
    body: (
      <>
        O uso das informações recebidas das APIs do Google segue a{" "}
        <a
          className="font-medium text-accent underline underline-offset-2"
          href="https://developers.google.com/terms/api-services-user-data-policy"
        >
          Política de Dados do Usuário dos Serviços de API do Google
        </a>
        , incluindo os requisitos de uso limitado.
      </>
    ),
  },
  {
    title: "Como revogar o acesso",
    body: (
      <>
        Quem autorizou o acesso pode removê-lo quando quiser em{" "}
        <a className="font-medium text-accent underline underline-offset-2" href="https://myaccount.google.com/permissions">
          myaccount.google.com/permissions
        </a>
        . A partir daí o painel deixa de ler os dados. Dúvidas sobre esta política podem ser enviadas ao responsável
        pelo painel na equipe do projeto.
      </>
    ),
  },
];

/**
 * Política de privacidade pública (fica fora do login, ver proxy.ts). O Google pede este link na
 * página de branding do app OAuth para publicá-lo.
 */
export default function PrivacyPage() {
  return (
    <main className="min-h-dvh bg-frame px-4 py-10">
      <div className="mx-auto w-full max-w-[40rem]">
        <div className="mb-8 flex items-center justify-center gap-2.5" aria-label="Mycon, Dashboard CRO">
          <MyconLogo className="h-[24px] w-auto text-ink" />
          <span className="h-4 w-px bg-control" aria-hidden />
          <span className="text-sm font-bold tracking-tight text-ink">CRO</span>
        </div>

        <article className="rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8">
          <h1 className="text-xl font-bold tracking-[-0.02em] text-ink">Política de privacidade</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
            O Dashboard CRO é um painel interno que mostra dados do Google Analytics 4 da Mycon para a equipe do
            projeto. Esta página explica o que ele acessa e o que faz com esses dados.
          </p>

          {SECTIONS.map((s) => (
            <section key={s.title} className="mt-6">
              <h2 className="text-[0.9375rem] font-semibold text-ink">{s.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{s.body}</p>
            </section>
          ))}

          <p className="mt-8 text-xs text-muted">Atualizada em 18 de novembro de 2026.</p>
        </article>

        <p className="mt-6 text-center text-sm">
          <Link href="/login" className="font-medium text-accent underline underline-offset-2">
            Entrar no painel
          </Link>
        </p>
      </div>
    </main>
  );
}

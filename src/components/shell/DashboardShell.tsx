import { LogOut } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { authMode } from "@/lib/auth";
import { fmtRange } from "@/lib/format";
import { getFilterOptions, type PageContext } from "@/lib/ga4/context";
import { leadAvailable } from "@/lib/ga4/kpis";
import { compareLabel, FILTERS } from "@/lib/state";

import { ExportButton } from "./ExportButton";
import { FilterBar } from "./FilterBar";
import { MyconLogo } from "./MyconLogo";
import { MobileNav, Nav } from "./Nav";
import { PendingProvider } from "./PendingProvider";
import { PropertySwitch } from "./PropertySwitch";
import { ThemeToggle } from "./ThemeToggle";

/** Recuo lateral do conteúdo (a linha de filtros usa o mesmo valor). */
const PAD = "px-4 sm:px-6 lg:px-8 2xl:px-10";

/**
 * Estrutura comum, no estilo das referências: fundo neutro único, menu lateral sobre ele e
 * cartões brancos soltos, de cantos largos, no conteúdo. No celular o menu vira um botão no topo.
 * O título da página (PageHeader) vem primeiro, seguido da linha de período e filtros.
 */
export async function DashboardShell({
  page,
  section,
  children,
}: {
  page: PageContext;
  section: string;
  children: React.ReactNode;
}) {
  const { ctx, state, properties, propertyLabel } = page;
  // Falha aqui não derruba a página: a barra só fica sem as opções de filtro e sem o seletor de meta.
  const [options, lead] = await Promise.all([
    getFilterOptions(ctx).catch(() => ({})),
    leadAvailable(ctx.propertyId).catch(() => false),
  ]);
  const activeFilters = FILTERS.filter((f) => state.filters[f.key]?.length).map(
    (f) => `${f.label}: ${state.filters[f.key]!.join(", ")}`,
  );
  const exportName = `cro-${section}-${ctx.current.start}_${ctx.current.end}`;

  return (
    <PendingProvider>
      <div className="app-frame min-h-dvh bg-frame lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="no-print no-export thin-scroll sticky top-0 hidden h-dvh flex-col self-start overflow-y-auto px-4 pt-6 pb-5 lg:flex">
          <Link href="/" className="mb-8 flex items-center gap-2.5 px-3" aria-label="Mycon, Dashboard CRO">
            <MyconLogo className="h-[22px] w-auto shrink-0 text-ink" />
            <span className="h-4 w-px bg-control" aria-hidden />
            <span className="text-sm font-bold tracking-tight text-ink">CRO</span>
          </Link>
          {/* Os componentes de cliente que leem useSearchParams precisam de um Suspense em volta. */}
          <Suspense>
            <Nav />
          </Suspense>
          <div className="mt-auto px-3 pt-6 text-xs leading-relaxed text-muted">
            <p className="font-medium text-ink-2">{propertyLabel}</p>
            <p>Google Analytics 4, somente leitura</p>
          </div>
        </aside>

        <div className="min-w-0">
          <header
            className={`no-print no-export sticky top-0 z-30 flex h-16 items-center gap-2 bg-frame lg:static ${PAD}`}
          >
            <Suspense>
              <MobileNav />
            </Suspense>
            <Link href="/" className="mr-1 flex items-center gap-2 lg:hidden" aria-label="Mycon, Dashboard CRO">
              <MyconLogo className="h-[18px] w-auto text-ink" />
              <span className="hidden text-sm font-bold text-ink min-[25rem]:inline">CRO</span>
            </Link>
            <Suspense>
              <PropertySwitch properties={properties} propertyId={ctx.propertyId} />
            </Suspense>
            <div className="ml-auto flex items-center gap-2">
              <ThemeToggle />
              <ExportButton filename={exportName} />
              {authMode() === "on" && (
                <form action="/logout" method="post">
                  <button
                    type="submit"
                    aria-label="Sair do painel"
                    title="Sair"
                    className="grid size-9 place-items-center rounded-full border border-line bg-surface text-ink transition-colors hover:bg-active"
                  >
                    <LogOut size={16} aria-hidden />
                  </button>
                </form>
              )}
            </div>
          </header>

          <main className={`sheet flex min-w-0 flex-col pb-16 ${PAD}`}>
            {/* order-[-1]: a barra fica logo abaixo do PageHeader (order-first), que chega dentro de children. */}
            <div className="no-export no-print sticky top-16 z-20 order-[-1] mb-6 bg-frame py-3 lg:top-0">
              <Suspense>
                <FilterBar
                  current={ctx.current}
                  comparison={ctx.comparison}
                  today={ctx.today}
                  options={options}
                  leadAvailable={lead}
                />
              </Suspense>
            </div>

            {/* No HTML exportado a barra some e entra este resumo do período, da meta e dos filtros. */}
            <div className="export-only order-[-1] mb-6 rounded-2xl bg-surface px-5 py-3 text-sm text-ink-2">
              <strong className="text-ink">{propertyLabel}</strong> · {fmtRange(ctx.current)}
              {ctx.comparison && ` · comparado com ${compareLabel(state)} (${fmtRange(ctx.comparison)})`}
              {` · meta: ${lead && state.goal === "lead" ? "lead" : "compra"}`}
              {activeFilters.length > 0 && ` · ${activeFilters.join(" · ")}`}
            </div>

            {children}
          </main>
        </div>
      </div>
    </PendingProvider>
  );
}

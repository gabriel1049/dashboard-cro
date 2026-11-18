import { Suspense } from "react";

import { ExploreControls, type FieldOption } from "@/components/explore/ExploreControls";
import { DashboardShell } from "@/components/shell/DashboardShell";
import { DataTable, type ColumnSpec, type TableRow } from "@/components/table/DataTable";
import { MetaNotice } from "@/components/ui/MetaNotice";
import { Card, ErrorBlock, Notice, PageHeader, Skeleton, type Better } from "@/components/ui/primitives";
import { formatValue, type FormatKind } from "@/lib/format";
import { buildContext, type PageContext } from "@/lib/ga4/context";
import { CONVERSION_METRIC, getTerms } from "@/lib/ga4/kpis";
import { getMetadata, type FieldInfo, type Metadata } from "@/lib/ga4/metadata";
import { runReport, settle } from "@/lib/ga4/report";
import { FILTERS, type SearchParams } from "@/lib/state";

// Teto de linhas por consulta. Métricas: a Data API aceita no máximo 10 por relatório.
const LIMIT = 500;
const MAX_METRICS = 10;

/** Rótulos em português para os campos mais usados; o resto usa o nome do GA4. */
const PT: Record<string, string> = {
  sessionDefaultChannelGroup: "Canal",
  sessionSourceMedium: "Origem / mídia",
  sessionSource: "Origem",
  sessionMedium: "Mídia",
  sessionCampaignName: "Campanha",
  platform: "Plataforma",
  deviceCategory: "Dispositivo",
  operatingSystem: "Sistema operacional",
  operatingSystemWithVersion: "SO e versão",
  appVersion: "Versão do app",
  mobileDeviceBranding: "Marca do aparelho",
  mobileDeviceModel: "Modelo do aparelho",
  country: "País",
  region: "Estado",
  city: "Cidade",
  date: "Data",
  dayOfWeekName: "Dia da semana",
  hour: "Hora",
  newVsReturning: "Novo x recorrente",
  eventName: "Evento",
  unifiedScreenName: "Tela / título",
  landingPagePlusQueryString: "Página de entrada",
  itemName: "Item",
  itemCategory: "Categoria do item",
  sessions: "Sessões",
  totalUsers: "Usuários",
  activeUsers: "Usuários ativos",
  newUsers: "Novos usuários",
  engagedSessions: "Sessões engajadas",
  engagementRate: "Taxa de engajamento",
  bounceRate: "Taxa de rejeição",
  userEngagementDuration: "Tempo de engajamento",
  averageSessionDuration: "Duração média da sessão",
  screenPageViews: "Visualizações",
  eventCount: "Eventos",
  eventCountPerUser: "Eventos por usuário",
  keyEvents: "Eventos-chave",
  ecommercePurchases: "Compras",
  transactions: "Transações",
  totalPurchasers: "Compradores",
  addToCarts: "Adições ao carrinho",
  checkouts: "Checkouts",
  itemsViewed: "Itens vistos",
  itemsAddedToCart: "Itens no carrinho",
  itemsPurchased: "Itens comprados",
  [CONVERSION_METRIC]: "Conversão da sessão (purchase)",
  crashAffectedUsers: "Usuários com crash",
  crashFreeUsersRate: "Usuários sem crash",
};

/** Métricas em que cair é bom: a variação dessas aparece como melhora quando diminui. */
const LOWER_IS_BETTER = new Set(["bounceRate", "crashAffectedUsers"]);

/** Rótulo exibido do campo. A receita usa o nome que getTerms define para o painel todo. */
function labelOf(info: FieldInfo, revenueLabel: string) {
  if (info.apiName === "purchaseRevenue") return revenueLabel;
  return PT[info.apiName] ?? info.uiName;
}

/**
 * Métricas de tempo do GA4 e o fator que as converte para segundos, a unidade do formato "duration".
 * Sem a conversão, uma métrica em milissegundos apareceria mil vezes maior.
 */
const TIME_TO_SECONDS: Record<string, number> = {
  TYPE_SECONDS: 1,
  TYPE_MILLISECONDS: 0.001,
  TYPE_MINUTES: 60,
  TYPE_HOURS: 3600,
};

/** Fator para segundos se a métrica for de tempo; nas demais, 1 (valor sem mudança). */
const secondsFactor = (info: FieldInfo) => TIME_TO_SECONDS[info.type ?? ""] ?? 1;

/** Formato de exibição a partir do tipo que o metadata do GA4 informa para a métrica. */
function formatOf(info: FieldInfo): FormatKind {
  const t = info.type ?? "";
  if (t.includes("CURRENCY")) return "brl";
  if (t in TIME_TO_SECONDS) return "duration";
  if (t.includes("INTEGER")) return "int";
  // Taxa vem como TYPE_FLOAT, igual a uma média comum: só o nome da métrica diferencia.
  if (/Rate|Percentage/.test(info.apiName)) return "pct";
  return "decimal";
}

/** Primeiro valor de um parâmetro da URL, sem espaços nas pontas; vazio vira undefined. */
const pick = (sp: SearchParams, k: string) => {
  const v = sp[k];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
};

/**
 * Explorar dados: tabela livre com até duas dimensões e dez métricas, escolhidas entre os campos
 * que o getMetadata do GA4 lista para a propriedade. A seleção fica na URL (d1, d2 e m).
 */
export default async function ExplorePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const page = buildContext(sp);
  const md = await getMetadata(page.ctx.propertyId).catch(() => null);
  return (
    <DashboardShell page={page} section="explorar">
      <PageHeader
        title="Explorar dados"
        description="Monte a tabela que precisar: escolha até duas dimensões e até 10 métricas de qualquer campo disponível nesta propriedade. Período, comparação e filtros globais continuam valendo."
      />
      {!md ? (
        <ErrorBlock message="Não foi possível ler os campos da propriedade (getMetadata)." />
      ) : (
        <Explore page={page} md={md} sp={sp} />
      )}
    </DashboardShell>
  );
}

/** Lê a seleção da URL, descarta campos que a propriedade não tem e monta os atalhos prontos. */
function Explore({ page, md, sp }: { page: PageContext; md: Metadata; sp: SearchParams }) {
  const terms = getTerms();
  const has = { d: (d: string) => md.dimensions.has(d), m: (m: string) => md.metrics.has(m) };
  const mets = (...ms: string[]) => ms.filter(has.m);

  const defaults = mets("sessions", "totalUsers", "engagementRate", "ecommercePurchases", CONVERSION_METRIC, "purchaseRevenue");
  const d1 = has.d(pick(sp, "d1") ?? "") ? pick(sp, "d1")! : "sessionDefaultChannelGroup";
  const d2raw = pick(sp, "d2");
  const d2 = d2raw && has.d(d2raw) && d2raw !== d1 ? d2raw : undefined;
  const requested = (pick(sp, "m") ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  const unknown = requested.filter((m) => !has.m(m));
  const metrics = [...new Set(requested.filter(has.m))].slice(0, MAX_METRICS);
  const selected = metrics.length ? metrics : defaults;

  // Atalho só aparece quando todos os campos dele existem na propriedade (app e site têm campos diferentes).
  const shortcuts = [
    { label: "Canal × plataforma", d1: "sessionDefaultChannelGroup", d2: "platform", m: defaults },
    { label: "Versão do app", d1: "appVersion", d2: "platform", m: mets("activeUsers", "sessions", "ecommercePurchases", CONVERSION_METRIC, "crashAffectedUsers") },
    { label: "Telas", d1: "unifiedScreenName", m: mets("screenPageViews", "activeUsers", "userEngagementDuration", "eventCount") },
    { label: "Eventos", d1: "eventName", m: mets("eventCount", "totalUsers", "eventCountPerUser", "keyEvents") },
    { label: "Por dia", d1: "date", m: mets("sessions", "totalUsers", "ecommercePurchases", CONVERSION_METRIC, "purchaseRevenue") },
    { label: "Origem / mídia", d1: "sessionSourceMedium", m: defaults },
    { label: "Campanhas", d1: "sessionCampaignName", d2: "sessionSourceMedium", m: defaults },
    { label: "Aparelhos", d1: "mobileDeviceBranding", d2: "operatingSystem", m: mets("activeUsers", "sessions", "engagementRate", CONVERSION_METRIC) },
    { label: "Cidades", d1: "city", m: defaults },
  ].filter((s) => has.d(s.d1) && (!s.d2 || has.d(s.d2)) && s.m.length);

  const toOption = (f: FieldInfo): FieldOption => ({ id: f.apiName, label: labelOf(f, terms.revenue), category: f.category });
  const byLabel = (a: FieldOption, b: FieldOption) => a.label.localeCompare(b.label, "pt-BR");
  const dimOptions = [...md.dimensions.values()].map(toOption).sort(byLabel);
  const metOptions = [...md.metrics.values()].map(toOption).sort(byLabel);

  // Muda a key quando a seleção da URL muda, para os controles recomeçarem do estado novo.
  const key = `${d1}|${d2 ?? ""}|${selected.join(",")}`;
  return (
    <div className="space-y-5">
      <Card title="Campos">
        <ExploreControls key={key} max={MAX_METRICS} dimensions={dimOptions} metrics={metOptions} d1={d1} d2={d2} selected={selected} shortcuts={shortcuts} />
      </Card>
      {unknown.length > 0 && (
        <Notice tone="warning" title="Campos ignorados">
          {unknown.join(", ")} não existe{unknown.length > 1 ? "m" : ""} nesta propriedade do GA4.
        </Notice>
      )}
      <Suspense fallback={<Skeleton className="h-[520px]" />}>
        <ExploreTable page={page} md={md} d1={d1} d2={d2} metrics={selected} revenueLabel={terms.revenue} />
      </Suspense>
    </div>
  );
}

/** Roda o relatório escolhido e mostra a tabela com os totais do GA4, que somam todas as linhas e não só as exibidas. */
async function ExploreTable({
  page,
  md,
  d1,
  d2,
  metrics,
  revenueLabel,
}: {
  page: PageContext;
  md: Metadata;
  d1: string;
  d2?: string;
  metrics: string[];
  revenueLabel: string;
}) {
  const dims = d2 ? [d1, d2] : [d1];
  // Com só a data como dimensão, a ordem é cronológica; no resto, a primeira métrica decide quais linhas entram no limite.
  const res = await settle(
    runReport(page.ctx, {
      dimensions: dims,
      metrics,
      orderBy: d1 === "date" && !d2 ? { dimension: "date" } : { metric: metrics[0] },
      limit: LIMIT,
      totals: true,
    }),
  );
  if (!res.ok) return <ErrorBlock message={res.error} />;

  const filterKeyOf = (d: string) => FILTERS.find((f) => f.dimension === d)?.key;
  const columns: ColumnSpec[] = [
    ...dims.map((d) => ({
      key: d,
      label: labelOf(md.dimensions.get(d)!, revenueLabel),
      type: "dim" as const,
      filterKey: filterKeyOf(d),
    })),
    ...metrics.map((m) => {
      const info = md.metrics.get(m)!;
      return {
        key: m,
        label: labelOf(info, revenueLabel),
        type: "metric" as const,
        format: formatOf(info),
        delta: res.data.hasComparison,
        bar: m === metrics[0],
        better: (LOWER_IS_BETTER.has(m) ? "down" : "up") as Better,
        help: m,
      };
    }),
  ];

  // A dimensão date vem como AAAAMMDD; na tabela vira AAAA-MM-DD.
  const isoDay = (v: string) => (/^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : v);
  // Métricas de tempo passam para segundos aqui, antes da tabela, dos totais e da exportação.
  const factor = Object.fromEntries(metrics.map((m) => [m, secondsFactor(md.metrics.get(m)!)]));
  const rows: TableRow[] = res.data.rows.map((r) => ({
    id: r.key,
    values: {
      ...Object.fromEntries(dims.map((d) => [d, d === "date" ? isoDay(r.dims[d]) : r.dims[d]])),
      ...Object.fromEntries(metrics.map((m) => [m, (r.cur[m] ?? 0) * factor[m]])),
    },
    prev: r.prev ? Object.fromEntries(metrics.map((m) => [m, (r.prev![m] ?? 0) * factor[m]])) : undefined,
  }));

  const total = Object.fromEntries(Object.entries(res.data.totals.cur).map(([m, v]) => [m, v * (factor[m] ?? 1)]));
  const truncated = rows.length >= LIMIT;
  return (
    <div className="space-y-5">
      <MetaNotice meta={res.data.meta} />
      <Card
        title="Resultado"
        subtitle={
          truncated
            ? `Mostrando as ${LIMIT} primeiras linhas (ordenadas por ${labelOf(md.metrics.get(metrics[0])!, revenueLabel).toLowerCase()}). Os totais consideram todas as linhas.`
            : `${rows.length} linha${rows.length === 1 ? "" : "s"}.`
        }
      >
        <DataTable
          filename={`explorar-${dims.join("-")}`}
          columns={columns}
          rows={rows}
          initialSort={d1 === "date" && !d2 ? { key: "date", desc: false } : { key: metrics[0] }}
          pageSize={25}
        />
        {Object.keys(total).length > 0 && (
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 sm:grid-cols-3 lg:grid-cols-5">
            {metrics.map((m) => (
              <TotalCell key={m} label={labelOf(md.metrics.get(m)!, revenueLabel)} value={total[m] ?? 0} format={formatOf(md.metrics.get(m)!)} />
            ))}
          </dl>
        )}
      </Card>
    </div>
  );
}

/** Um total da consulta, no formato da métrica. */
function TotalCell({ label, value, format }: { label: string; value: number; format: FormatKind }) {
  return (
    <div>
      <dt className="text-xs text-ink-2">Total · {label}</dt>
      <dd className="tabular mt-0.5 text-sm font-semibold text-ink">{formatValue(value, format)}</dd>
    </div>
  );
}

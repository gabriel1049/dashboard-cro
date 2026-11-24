import { Suspense } from "react";

import { ShareCompare, type CompareSeries } from "@/components/charts/ShareCompare";
import { DashboardShell } from "@/components/shell/DashboardShell";
import { DataTable, type ColumnSpec } from "@/components/table/DataTable";
import { Card, ErrorBlock, Notice, PageHeader, Skeleton } from "@/components/ui/primitives";
import { fmtDay, fmtInt, fmtPct, fmtRange } from "@/lib/format";
import {
  lastProfiledPurchaseDay,
  PROFILE_MIN_PURCHASES as MIN_PURCHASES,
  PROFILE_MIN_SHARE as MIN_SHARE,
  profileHighlights,
  profileReport,
  type ProfileReport,
} from "@/lib/ga4/briefing";
import { buildContext, type PageContext } from "@/lib/ga4/context";
import { settle } from "@/lib/ga4/report";
import { addDays, type Range, type SearchParams } from "@/lib/state";

/**
 * Perfil do usuário: faixa etária e gênero (Google Signals) cruzados com leads e compras. Quando a
 * compra do período chega sem perfil, mostra também o último período em que ela ainda vinha com perfil.
 */
export default async function ProfilePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = buildContext(await searchParams);
  return (
    <DashboardShell page={page} section="perfil">
      <PageHeader
        title="Perfil do usuário"
        description="Quem visita e quem converte, por faixa etária, gênero e região. Quando a barra de leads ou de compras de um perfil passa a barra do público, esse perfil converte acima da média."
      />
      <Suspense fallback={<Skeleton className="h-[640px]" />}>
        <Profiles page={page} />
      </Suspense>
    </DashboardShell>
  );
}

/** Regiões no gráfico; as demais ficam na tabela. */
const REGION_CHART_ROWS = 12;

/** Idade, gênero e região em paralelo, cada um falhando sozinho, mais o aviso de cobertura e as tabelas. */
async function Profiles({ page }: { page: PageContext }) {
  const [age, gender, region] = await Promise.all([
    settle(profileReport(page.ctx, "userAgeBracket")),
    settle(profileReport(page.ctx, "userGender")),
    settle(profileReport(page.ctx, "region")),
  ]);
  const ref = age.ok ? age.data : gender.ok ? gender.data : null;
  // Poucas compras com perfil no período: busca o histórico de quando a compra ainda vinha com idade.
  const needsHistory = ref ? ref.total.purchases - ref.unknown.purchases < MIN_PURCHASES : false;
  return (
    <div className="space-y-5 2xl:space-y-6">
      {ref && <CoverageNotice report={ref} history={needsHistory} />}
      <div className="grid gap-5 2xl:gap-6 min-[100rem]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {age.ok ? (
          <ProfileChart report={age.data} title="Faixa etária" noun="faixa" />
        ) : (
          <Card title="Faixa etária">
            <ErrorBlock message={age.error} />
          </Card>
        )}
        {gender.ok ? (
          <ProfileChart report={gender.data} title="Gênero" noun="gênero" />
        ) : (
          <Card title="Gênero">
            <ErrorBlock message={gender.error} />
          </Card>
        )}
      </div>
      {region.ok ? (
        <ProfileChart report={region.data} title="Região" noun="região" limit={REGION_CHART_ROWS} />
      ) : (
        <Card title="Região">
          <ErrorBlock message={region.error} />
        </Card>
      )}
      {needsHistory && (
        <Suspense fallback={<Skeleton className="h-80" />}>
          <PurchaseHistory page={page} />
        </Suspense>
      )}
      {age.ok && <ProfileTable report={age.data} title="Faixa etária em números" dimLabel="Faixa etária" file="perfil-idade" />}
      {gender.ok && <ProfileTable report={gender.data} title="Gênero em números" dimLabel="Gênero" file="perfil-genero" />}
      {region.ok && <ProfileTable report={region.data} title="Região em números" dimLabel="Região" file="perfil-regiao" />}
    </div>
  );
}

/** Explica o que fica de fora: compras sem perfil (envio pelo servidor) e o limite de privacidade do GA4. */
function CoverageNotice({ report, history }: { report: ProfileReport; history: boolean }) {
  const knownPurchases = report.total.purchases - report.unknown.purchases;
  const purchasesHidden = report.total.purchases > 0 && knownPurchases < MIN_PURCHASES;
  return (
    <Notice tone={purchasesHidden ? "warning" : "info"} title={purchasesHidden ? "Compras quase sem idade e gênero" : "Cobertura dos dados de perfil"}>
      <p>
        Idade e gênero vêm do Google Signals e só existem para parte dos usuários: neste período,{" "}
        <strong className="font-semibold text-ink">{fmtPct(1 - report.unknownUserShare, 0)}</strong> dos usuários têm a faixa.
        {report.total.purchases > 0 && (
          <>
            {" "}
            Das {fmtInt(report.total.purchases)} compras, <strong className="font-semibold text-ink">{fmtPct(report.unknownPurchaseShare, 0)}</strong>{" "}
            chegam sem perfil.
          </>
        )}
      </p>
      {purchasesHidden && (
        <p className="mt-1.5">
          A compra é enviada pelo servidor sem o identificador do navegador, então o GA4 não consegue ligar a compra aos dados
          demográficos. Por isso, neste período, o perfil que converte é lido pelos leads, que saem do navegador.
          {history && " Idade e gênero das compras aparecem no bloco de compras, com o último período em que a compra ainda chegava com perfil."}
        </p>
      )}
      {report.thresholding && (
        <p className="mt-1.5">O GA4 aplicou limite de privacidade: faixas com poucos usuários podem ter sido omitidas.</p>
      )}
    </Notice>
  );
}

/** "25-34 traz mais leads: 36% do total, com 37% do público. 18-24 é a faixa que mais converte: ..." */
function profileSummary(report: ProfileReport, noun: string): string | null {
  const h = profileHighlights(report);
  if (!h) return null;
  const { metric, share, index, top, best } = h;
  const who = noun === "faixa" ? "a faixa" : noun === "região" ? "a região" : "o gênero";
  const times = `${index(best).toFixed(1).replace(".", ",")}x a média`;
  if (top.key === best.key) {
    return `${top.label} traz mais ${metric} e é ${who} que mais converte: ${fmtPct(share(top), 0)} dos ${metric} com ${fmtPct(top.shareUsers, 0)} do público (${times}).`;
  }
  return (
    `${top.label} traz mais ${metric}: ${fmtPct(share(top), 0)} do total, com ${fmtPct(top.shareUsers, 0)} do público. ` +
    `${best.label} é ${who} que mais converte: ${fmtPct(share(best), 0)} dos ${metric} com ${fmtPct(best.shareUsers, 0)} do público (${times}).`
  );
}

/** Barras de participação no público, nos leads e, com compras suficientes, nas compras. */
function ProfileChart({
  report,
  title,
  noun,
  limit,
}: {
  report: ProfileReport;
  title: string;
  noun: string;
  /** Mostra só os N perfis com mais usuários (região tem dezenas); a tabela traz todos. */
  limit?: number;
}) {
  const knownPurchases = report.total.purchases - report.unknown.purchases;
  const rows = limit ? report.rows.slice(0, limit) : report.rows;
  const series: CompareSeries[] = [{ label: "% dos usuários", color: "compare", values: rows.map((r) => r.shareUsers) }];
  if (report.hasLead) series.push({ label: "% dos leads", color: "accent", values: rows.map((r) => r.shareLeads) });
  if (knownPurchases >= MIN_PURCHASES) {
    series.push({ label: "% das compras", color: "highlight", values: rows.map((r) => r.sharePurchases) });
  }
  const summary =
    profileSummary(report, noun) ?? "Participação de cada perfil no público e na conversão, só entre quem tem o perfil identificado.";
  const subtitle =
    limit && report.rows.length > limit ? `${summary} No gráfico, as ${limit} com mais usuários; a tabela abaixo traz todas.` : summary;
  return (
    <Card title={title} subtitle={subtitle}>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-2">Sem usuários com {noun} identificado no período.</p>
      ) : (
        <ShareCompare categories={rows.map((r) => r.label)} series={series} ariaLabel={`Participação por ${title.toLowerCase()}`} />
      )}
    </Card>
  );
}

/** Tabela do perfil. As colunas de participação em compras só aparecem com compras com perfil suficientes. */
function ProfileTable({ report, title, dimLabel, file }: { report: ProfileReport; title: string; dimLabel: string; file: string }) {
  const knownPurchases = report.total.purchases - report.unknown.purchases;
  const columns: ColumnSpec[] = [
    { key: "label", label: dimLabel, type: "dim" },
    { key: "users", label: "Usuários", type: "metric", format: "int", bar: true, delta: true },
    { key: "shareUsers", label: "% dos usuários", type: "metric", format: "pct" },
    ...(report.hasLead
      ? ([
          { key: "leads", label: "Leads", type: "metric", format: "int", delta: true },
          { key: "shareLeads", label: "% dos leads", type: "metric", format: "pct" },
          { key: "leadRate", label: "Taxa de lead", type: "metric", format: "pct", help: "Sessões com lead ÷ sessões" },
          {
            key: "leadIndex",
            label: "Índice de lead",
            type: "metric",
            format: "decimal",
            help: "% dos leads ÷ % dos usuários. Acima de 1, o perfil converte acima da média.",
          },
        ] as ColumnSpec[])
      : []),
    // Sem compras com perfil, a variação de compras só mostra a mudança de medição: fica sem delta.
    { key: "purchases", label: "Compras", type: "metric", format: "int", delta: knownPurchases >= MIN_PURCHASES },
    ...(knownPurchases >= MIN_PURCHASES
      ? ([
          { key: "sharePurchases", label: "% das compras", type: "metric", format: "pct" },
          { key: "purchaseRate", label: "Compras por sessão", type: "metric", format: "pct" },
        ] as ColumnSpec[])
      : []),
  ];
  return (
    <Card
      title={title}
      subtitle={`Participações calculadas entre quem tem o perfil identificado. Sem perfil: ${fmtInt(report.unknown.users)} usuários${report.hasLead ? `, ${fmtInt(report.unknown.leads)} leads` : ""} e ${fmtInt(report.unknown.purchases)} compras.`}
    >
      <DataTable
        filename={file}
        columns={columns}
        rows={report.rows.map((r) => ({
          id: r.key,
          values: {
            label: r.label,
            users: r.users,
            shareUsers: r.shareUsers,
            leads: r.leads,
            shareLeads: r.shareLeads,
            leadRate: r.leadRate,
            leadIndex: r.shareUsers ? r.shareLeads / r.shareUsers : null,
            purchases: r.purchases,
            sharePurchases: r.sharePurchases,
            purchaseRate: r.purchaseRate,
          },
          prev: r.prev ? { users: r.prev.users, leads: r.prev.leads, purchases: r.prev.purchases } : undefined,
        }))}
        searchable={false}
        pageSize={20}
      />
    </Card>
  );
}

/**
 * Idade e gênero x compras no último período em que a compra ainda chegava com perfil
 * (90 dias até o último dia com compras identificadas). Atende o "perfil x purchase" do briefing
 * enquanto a compra enviada pelo servidor não carrega o identificador do navegador.
 */
async function PurchaseHistory({ page }: { page: PageContext }) {
  const end = await lastProfiledPurchaseDay(page.ctx).catch(() => null);
  if (!end) return null;
  const range: Range = { start: addDays(end, -89), end };
  const [age, gender] = await Promise.all([
    settle(profileReport(page.ctx, "userAgeBracket", { range })),
    settle(profileReport(page.ctx, "userGender", { range })),
  ]);
  if (!age.ok) return <ErrorBlock message={age.error} />;
  const known = age.data.total.purchases - age.data.unknown.purchases;
  if (known < MIN_PURCHASES) return null;
  // Perfil que mais compra para o seu tamanho (compras ÷ público), entre os com fatia mínima do público.
  const best = (r: ProfileReport) =>
    r.rows.filter((x) => x.shareUsers >= MIN_SHARE).sort((a, b) => b.sharePurchases / b.shareUsers - a.sharePurchases / a.shareUsers)[0];
  const topAge = best(age.data);
  const topGender = gender.ok ? best(gender.data) : undefined;
  return (
    <Card
      title="Compras por idade e gênero"
      subtitle={`${fmtRange(range)}: os 90 dias até ${fmtDay(end.replaceAll("-", ""))}, último dia em que a compra chegava com perfil (${fmtInt(known)} compras com faixa etária). ${
        topAge ? `${topAge.label} compra mais que o seu peso no público (${fmtPct(topAge.sharePurchases, 0)} das compras com ${fmtPct(topAge.shareUsers, 0)} dos usuários)` : ""
      }${topGender ? `; por gênero, ${topGender.label.toLowerCase()} (${fmtPct(topGender.sharePurchases, 0)} das compras).` : "."}`}
    >
      <div className="grid gap-8 min-[100rem]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div>
          <p className="mb-2 text-sm font-semibold text-ink">Faixa etária</p>
          <ShareCompare
            categories={age.data.rows.map((r) => r.label)}
            series={[
              { label: "% dos usuários", color: "compare", values: age.data.rows.map((r) => r.shareUsers) },
              { label: "% das compras", color: "highlight", values: age.data.rows.map((r) => r.sharePurchases) },
            ]}
            ariaLabel="Participação nas compras por faixa etária"
          />
        </div>
        {gender.ok && (
          <div>
            <p className="mb-2 text-sm font-semibold text-ink">Gênero</p>
            <ShareCompare
              categories={gender.data.rows.map((r) => r.label)}
              series={[
                { label: "% dos usuários", color: "compare", values: gender.data.rows.map((r) => r.shareUsers) },
                { label: "% das compras", color: "highlight", values: gender.data.rows.map((r) => r.sharePurchases) },
              ]}
              ariaLabel="Participação nas compras por gênero"
            />
          </div>
        )}
      </div>
    </Card>
  );
}

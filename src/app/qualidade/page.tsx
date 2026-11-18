import {
  CircleCheck,
  CircleExclamationPoint,
  OctagonExclamationPoint,
} from "lucide-react";
import { Suspense } from "react";

import { MiniTrend } from "@/components/charts/Charts";
import { DashboardShell } from "@/components/shell/DashboardShell";
import { DataTable, type TableRow } from "@/components/table/DataTable";
import { MetaNotice } from "@/components/ui/MetaNotice";
import {
  Badge,
  Card,
  ErrorBlock,
  PageHeader,
  Skeleton,
  type Tone,
} from "@/components/ui/primitives";
import { EVENT_LABELS, NOT_CONVERSIONS } from "@/config/cro";
import { fmtBRL, fmtDay, fmtInt, fmtPct } from "@/lib/format";
import { buildContext, type PageContext } from "@/lib/ga4/context";
import { eventInventory, getTerms } from "@/lib/ga4/kpis";
import { getMetadata } from "@/lib/ga4/metadata";
import {
  inList,
  mergeMeta,
  runReport,
  settle,
  type ReportMeta,
} from "@/lib/ga4/report";
import {
  ATTRIBUTION_ALERT,
  purchaseAttribution,
  transactionQuality,
} from "@/lib/quality";
import { addDays, type SearchParams } from "@/lib/state";
import { defaultFunnel } from "@/lib/views";

/** Dimensões verificadas para "(not set)": os valores tidos como vazio e a métrica que mede o volume. */
const NOT_SET_CHECKS = [
  {
    dim: "sessionDefaultChannelGroup",
    metric: "sessions",
    blanks: ["Unassigned", "(not set)"],
    label: "Canal (Unassigned)",
  },
  {
    dim: "sessionSourceMedium",
    metric: "sessions",
    blanks: ["(not set)", "(not set) / (not set)"],
    label: "Origem / mídia",
  },
  {
    dim: "newVsReturning",
    metric: "sessions",
    blanks: ["(not set)", ""],
    label: "Novo x recorrente",
  },
  { dim: "country", metric: "sessions", blanks: ["(not set)"], label: "País" },
  {
    dim: "unifiedScreenName",
    metric: "screenPageViews",
    blanks: ["(not set)"],
    label: "Tela / título da página",
  },
  {
    dim: "landingPagePlusQueryString",
    metric: "sessions",
    blanks: ["(not set)", ""],
    label: "Página de entrada",
  },
  {
    dim: "itemName",
    metric: "itemsViewed",
    blanks: ["(not set)"],
    label: "Nome do item",
  },
];

/** Status pela fatia afetada: por padrão 5% já pede atenção e 20% é crítico. */
const toneFor = (share: number, warn = 0.05, crit = 0.2): Tone =>
  share >= crit ? "critical" : share >= warn ? "warning" : "good";

/**
 * Qualidade dos dados: verificações do tracking que distorcem os números de CRO (transaction_id,
 * compras sem origem, "(not set)", coerência do funil, quedas diárias e eventos-chave), todas
 * calculadas a partir de relatórios do GA4.
 */
export default async function QualityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const page = buildContext(await searchParams);
  return (
    <DashboardShell page={page} section="qualidade">
      <PageHeader
        title="Qualidade dos dados"
        description="Saúde do tracking: o que pode estar distorcendo os números de CRO. Cada verificação tem um status e a explicação do impacto."
      />
      <Suspense fallback={<Skeleton className="h-[720px]" />}>
        <Quality page={page} />
      </Suspense>
    </DashboardShell>
  );
}

type Check = { title: string; tone: Tone; detail: string };

/** Roda as consultas em paralelo, monta cada verificação com status e detalhe e mostra as tabelas de apoio. */
async function Quality({ page }: { page: PageContext }) {
  const { ctx } = page;
  const terms = getTerms();
  const md = await getMetadata(ctx.propertyId).catch(() => null);
  const { steps } = await defaultFunnel(ctx);
  // session_start entra como base de comparação para as etapas do funil.
  const trendEvents = [
    ...new Set(["session_start", ...steps.map((s) => s.event)]),
  ];

  const notSetChecks = NOT_SET_CHECKS.filter(
    (c) => md?.dimensions.has(c.dim) && md?.metrics.has(c.metric),
  );
  const [tx, notSet, funnelVol, daily, keyEvents, attribution] =
    await Promise.all([
      settle(transactionQuality(ctx)),
      Promise.all(
        notSetChecks.map(async (c) => ({
          check: c,
          res: await settle(
            runReport(ctx, {
              dimensions: [c.dim],
              metrics: [c.metric],
              compare: false,
              totals: true,
              limit: 2000,
            }),
          ),
        })),
      ),
      settle(
        runReport(ctx, {
          dimensions: ["eventName"],
          metrics: ["eventCount", "totalUsers"],
          where: inList(
            "eventName",
            steps.map((s) => s.event),
          ),
          compare: false,
        }),
      ),
      settle(
        runReport(ctx, {
          dimensions: ["date", "eventName"],
          metrics: ["eventCount"],
          where: inList("eventName", trendEvents),
          compare: false,
          limit: 20_000,
        }),
      ),
      settle(eventInventory(ctx)),
      settle(purchaseAttribution(ctx)),
    ]);

  const checks: Check[] = [];
  const metas: ReportMeta[] = [];

  // --- compras / transaction_id
  if (tx.ok) {
    const q = tx.data;
    metas.push(q.meta);
    checks.push({
      title: "Compras sem ID de transação",
      tone: q.purchaseEvents ? toneFor(q.missingShare, 0.01, 0.1) : "good",
      detail: `${fmtInt(q.missingIdEvents)} de ${fmtInt(q.purchaseEvents)} eventos de compra (${fmtPct(q.missingShare)}) sem transaction_id.`,
    });
    checks.push({
      title: "ID de transação repetido",
      tone:
        q.dupIds === 0
          ? "good"
          : q.dupExtra / Math.max(q.purchaseEvents, 1) >= 0.05
            ? "critical"
            : "warning",
      detail: `${fmtInt(q.dupIds)} IDs disparados mais de uma vez (${fmtInt(q.dupExtra)} compras extras).`,
    });
    checks.push({
      title: "Compras sem valor",
      tone:
        q.zeroRevenueIds === 0
          ? "good"
          : q.zeroRevenueIds / Math.max(q.distinctIds, 1) >= 0.05
            ? "critical"
            : "warning",
      detail: `${fmtInt(q.zeroRevenueIds)} de ${fmtInt(q.distinctIds)} transações identificadas com ${terms.revenue.toLowerCase()} zero.`,
    });
  }

  // --- compras sem origem (canal Unassigned / not set)
  if (attribution.ok && attribution.data.total > 0) {
    const a = attribution.data;
    checks.push({
      title: "Compras sem origem",
      tone:
        a.share >= ATTRIBUTION_ALERT
          ? "critical"
          : a.share >= 0.05
            ? "warning"
            : "good",
      detail:
        a.share >= 0.05
          ? `${fmtInt(a.unattributed)} de ${fmtInt(a.total)} compras (${fmtPct(a.share)}) chegam sem canal, página e dispositivo. Costuma ser o purchase enviado pelo servidor sem o client_id e o session_id do navegador: o GA4 cria uma sessão nova e o funil não liga o checkout à compra. Correção: repassar client_id e session_id do navegador no envio do servidor (ou disparar o purchase no navegador).`
          : `${fmtPct(a.share)} das compras sem canal.`,
    });
  }

  // --- (not set)
  const notSetRows: TableRow[] = [];
  for (const { check, res } of notSet) {
    if (!res.ok) continue;
    metas.push(res.data.meta);
    const total = res.data.totals.cur[check.metric] ?? 0;
    const blank = res.data.rows
      .filter((r) => check.blanks.includes(r.dims[check.dim]))
      .reduce((n, r) => n + (r.cur[check.metric] ?? 0), 0);
    // "(other)" é onde o GA4 junta valores quando a dimensão passa do limite de cardinalidade.
    const other = res.data.rows
      .filter((r) => r.dims[check.dim] === "(other)")
      .reduce((n, r) => n + (r.cur[check.metric] ?? 0), 0);
    const share = total ? blank / total : 0;
    const otherShare = total ? other / total : 0;
    if (check.dim === "landingPagePlusQueryString" && share >= 0.9) continue; // propriedade de app: não há página de entrada
    const tone = toneFor(share);
    notSetRows.push({
      id: check.dim,
      values: {
        label: check.label,
        dim: check.dim,
        metric: check.metric,
        blank,
        share,
        otherShare,
      },
      flags: [
        {
          label:
            tone === "good" ? "Ok" : tone === "warning" ? "Atenção" : "Crítico",
          tone,
        },
        ...(otherShare >= 0.01
          ? [
              {
                label: `${fmtPct(otherShare)} em (other)`,
                tone: "warning" as const,
              },
            ]
          : []),
      ],
    });
  }
  const worstNotSet = notSetRows.filter(
    (r) => (r.values.share as number) >= 0.05,
  );
  checks.push({
    title: "(not set) nas dimensões principais",
    tone: worstNotSet.some((r) => (r.values.share as number) >= 0.2)
      ? "critical"
      : worstNotSet.length
        ? "warning"
        : "good",
    detail: worstNotSet.length
      ? worstNotSet
          .map((r) => `${r.values.label}: ${fmtPct(r.values.share as number)}`)
          .join(" · ")
      : "Abaixo de 5% em todas as dimensões verificadas.",
  });

  // --- coerência do funil
  const volRows: TableRow[] = [];
  if (funnelVol.ok) {
    metas.push(funnelVol.data.meta);
    const by = new Map(
      funnelVol.data.rows.map((r) => [r.dims.eventName, r.cur]),
    );
    const issues: string[] = [];
    steps.forEach((s, i) => {
      const cur = by.get(s.event);
      const prev = i > 0 ? by.get(steps[i - 1].event) : undefined;
      const flags: TableRow["flags"] = [];
      if (cur && prev && cur.totalUsers > prev.totalUsers) {
        flags.push({
          label: "Mais usuários que a etapa anterior",
          tone: "warning",
        });
        issues.push(`${s.event} > ${steps[i - 1].event} (usuários)`);
      }
      if (cur && prev && cur.eventCount > prev.eventCount * 1.02) {
        flags.push({
          label: "Mais eventos que a etapa anterior",
          tone: "warning",
        });
        issues.push(`${s.event} > ${steps[i - 1].event} (eventos)`);
      }
      volRows.push({
        id: s.event,
        values: {
          step: `${i + 1}. ${EVENT_LABELS[s.event] ?? s.event}`,
          event: s.event,
          eventCount: cur?.eventCount ?? 0,
          users: cur?.totalUsers ?? 0,
        },
        flags,
      });
    });
    checks.push({
      title: "Volume incoerente no funil",
      tone: issues.length ? "warning" : "good",
      detail: issues.length
        ? [...new Set(issues)].join(" · ")
        : "Cada etapa tem menos volume que a anterior.",
    });
  }

  // --- quedas bruscas por dia
  const yesterday = addDays(ctx.today, -1);
  const trends: {
    event: string;
    points: { date: string; value: number }[];
    anomalies: string[];
  }[] = [];
  if (daily.ok) {
    metas.push(daily.data.meta);
    for (const ev of trendEvents) {
      const byDate = new Map(
        daily.data.rows
          .filter((r) => r.dims.eventName === ev)
          .map((r) => [r.dims.date, r.cur.eventCount ?? 0]),
      );
      const points: { date: string; value: number }[] = [];
      for (let d = ctx.current.start; d <= ctx.current.end; d = addDays(d, 1)) {
        const key = d.replaceAll("-", "");
        points.push({ date: key, value: byDate.get(key) ?? 0 });
      }
      // Queda = dia abaixo da metade da mediana dos 7 anteriores (com mediana de 20 ou mais); os 7
      // primeiros dias só servem de base. Ontem fica de fora porque o GA4 ainda pode estar processando.
      const anomalies: string[] = [];
      points.forEach((p, i) => {
        if (i < 7 || p.date === yesterday.replaceAll("-", "")) return;
        const window = points
          .slice(i - 7, i)
          .map((x) => x.value)
          .sort((a, b) => a - b);
        const med = window[3];
        if (med >= 20 && p.value < med * 0.5) anomalies.push(p.date);
      });
      trends.push({ event: ev, points, anomalies });
    }
    const total = trends.reduce((n, t) => n + t.anomalies.length, 0);
    checks.push({
      title: "Quedas bruscas de eventos",
      tone: total ? "warning" : "good",
      detail: total
        ? trends
            .filter((t) => t.anomalies.length)
            .map((t) => `${t.event}: ${t.anomalies.map(fmtDay).join(", ")}`)
            .join(" · ")
        : "Nenhum dia com volume abaixo da metade da mediana dos 7 dias anteriores.",
    });
  }

  // --- eventos-chave
  let keyRows: TableRow[] = [];
  if (keyEvents.ok) {
    const keys = keyEvents.data.filter((e) => e.keyEvents > 0);
    const wrong = keys.filter((e) => NOT_CONVERSIONS.includes(e.event));
    keyRows = keys.map((e) => ({
      id: e.event,
      values: { event: e.event, keyEvents: e.keyEvents, users: e.users },
      flags: NOT_CONVERSIONS.includes(e.event)
        ? [{ label: "Não deveria ser evento-chave", tone: "warning" }]
        : e.event === "(other)"
          ? [{ label: "Agrupado pelo GA4", tone: "info" }]
          : [],
    }));
    checks.push({
      title: "Eventos-chave configurados",
      tone: wrong.length ? "warning" : "good",
      detail: wrong.length
        ? `${wrong.map((w) => w.event).join(", ")} ${wrong.length === 1 ? "está marcado como evento-chave e infla" : "estão marcados como eventos-chave e inflam"} a taxa de conversão padrão do GA4.`
        : `${keys.length} eventos-chave, nenhum suspeito.`,
    });
  }

  const counts = { critical: 0, warning: 0, good: 0, info: 0 } as Record<
    Tone,
    number
  >;
  for (const c of checks) counts[c.tone]++;
  const ICON = {
    critical: OctagonExclamationPoint,
    warning: CircleExclamationPoint,
    good: CircleCheck,
    info: CircleCheck,
  };
  const CLS = {
    critical: "text-critical-ink",
    warning: "text-warning-ink",
    good: "text-good-ink",
    info: "text-accent",
  };

  return (
    <div className="space-y-5">
      <MetaNotice meta={mergeMeta(...metas)} />
      <Card
        title="Resumo da saúde do tracking"
        subtitle={`${counts.critical} crítico${counts.critical === 1 ? "" : "s"} · ${counts.warning} alerta${counts.warning === 1 ? "" : "s"} · ${counts.good} ok`}
      >
        <div className="overflow-hidden">
          <ul className="-mt-px grid gap-x-10 min-[112.5rem]:grid-cols-2">
            {checks
              .sort(
                (a, b) =>
                  ["critical", "warning", "good", "info"].indexOf(a.tone) -
                  ["critical", "warning", "good", "info"].indexOf(b.tone),
              )
              .map((c) => {
                const Icon = ICON[c.tone];
                return (
                  <li
                    key={c.title}
                    className="flex gap-3 border-t border-rule py-3.5"
                  >
                    <Icon
                      size={18}
                      aria-hidden
                      className={`mt-px shrink-0 ${CLS[c.tone]}`}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">
                        {c.title}
                      </p>
                      <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-ink-2">
                        {c.detail}
                      </p>
                    </div>
                  </li>
                );
              })}
          </ul>
        </div>
      </Card>

      {tx.ok ? (
        <Card
          title="Compras e transaction_id"
          subtitle={`Valor mediano por compra identificada: ${fmtBRL(tx.data.medianValue)}. Compras repetidas ou sem ID inflam compras e ${terms.revenue.toLowerCase()}.`}
        >
          <div className="mb-5 grid grid-cols-2 border-y border-rule lg:grid-cols-4 lg:divide-x lg:divide-rule">
            <Stat
              label="Eventos de compra"
              value={fmtInt(tx.data.purchaseEvents)}
            />
            <Stat
              label="Sem transaction_id"
              value={fmtPct(tx.data.missingShare)}
              tone={toneFor(tx.data.missingShare, 0.01, 0.1)}
            />
            <Stat label="IDs únicos" value={fmtInt(tx.data.distinctIds)} />
            <Stat
              label="IDs repetidos"
              value={`${fmtInt(tx.data.dupIds)} (${fmtInt(tx.data.dupExtra)} extras)`}
              tone={tx.data.dupIds ? "warning" : "good"}
            />
          </div>
          {tx.data.topDups.length > 0 && (
            <DataTable
              filename="transacoes-repetidas"
              searchable={false}
              pageSize={10}
              columns={[
                { key: "id", label: "transaction_id repetido", type: "dim" },
                {
                  key: "events",
                  label: "Disparos",
                  type: "metric",
                  format: "int",
                  bar: true,
                },
                {
                  key: "revenue",
                  label: `${terms.revenue} somado`,
                  type: "metric",
                  format: "brl",
                },
              ]}
              rows={tx.data.topDups.map((d) => ({
                id: d.id,
                values: { id: d.id, events: d.events, revenue: d.revenue },
              }))}
            />
          )}
        </Card>
      ) : (
        <ErrorBlock message={tx.error} />
      )}

      <Card
        title="(not set) nas dimensões principais"
        subtitle="Participação do volume sem valor em cada dimensão. Acima de 5% já distorce as quebras. A coluna (other) mostra o que o GA4 agrupou por excesso de valores únicos."
      >
        <DataTable
          filename="qualidade-not-set"
          searchable={false}
          columns={[
            { key: "label", label: "Dimensão", type: "dim" },
            { key: "dim", label: "Campo", type: "dim" },
            { key: "metric", label: "Medido em", type: "dim" },
            {
              key: "blank",
              label: "Volume sem valor",
              type: "metric",
              format: "int",
            },
            {
              key: "share",
              label: "% do total",
              type: "metric",
              format: "pct",
              bar: true,
            },
            {
              key: "otherShare",
              label: "% em (other)",
              type: "metric",
              format: "pct",
              help: "Linhas agrupadas pelo GA4 por limite de cardinalidade",
            },
          ]}
          rows={notSetRows}
          initialSort={{ key: "share" }}
        />
      </Card>

      {volRows.length > 0 && (
        <Card
          title="Coerência do funil"
          subtitle="Cada etapa deveria ter menos volume que a anterior. Quando não tem, há disparo duplicado, caminho alternativo ou etapa sem tracking."
        >
          <DataTable
            filename="qualidade-funil"
            searchable={false}
            columns={[
              { key: "step", label: "Etapa", type: "dim" },
              { key: "event", label: "Evento", type: "dim" },
              {
                key: "eventCount",
                label: "Eventos",
                type: "metric",
                format: "int",
              },
              {
                key: "users",
                label: "Usuários",
                type: "metric",
                format: "int",
              },
            ]}
            rows={volRows}
          />
        </Card>
      )}

      {trends.length > 0 && (
        <Card
          title="Volume diário dos eventos"
          subtitle="Pontos em vermelho: dia com menos da metade da mediana dos 7 dias anteriores. O último dia é ignorado (o GA4 ainda pode estar processando)."
        >
          <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2 xl:grid-cols-3 min-[112.5rem]:grid-cols-4">
            {trends.map((t) => (
              <div key={t.event} className="min-w-0 border-t border-rule pt-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-ink">
                    {EVENT_LABELS[t.event] ?? t.event}
                  </p>
                  {t.anomalies.length > 0 ? (
                    <Badge tone="critical">{t.anomalies.length} queda(s)</Badge>
                  ) : (
                    <Badge tone="good">Estável</Badge>
                  )}
                </div>
                <MiniTrend
                  title={t.event}
                  points={t.points}
                  anomalies={t.anomalies}
                />
              </div>
            ))}
          </div>
        </Card>
      )}

      {keyRows.length > 0 && (
        <Card
          title="Eventos-chave (conversões) configurados"
          subtitle="Eventos marcados como evento-chave na propriedade, com volume no período."
        >
          <DataTable
            filename="eventos-chave"
            searchable={false}
            columns={[
              { key: "event", label: "Evento", type: "dim" },
              {
                key: "keyEvents",
                label: "Eventos-chave",
                type: "metric",
                format: "int",
                bar: true,
              },
              {
                key: "users",
                label: "Usuários",
                type: "metric",
                format: "int",
              },
            ]}
            rows={keyRows}
            initialSort={{ key: "keyEvents" }}
          />
        </Card>
      )}
    </div>
  );
}

/** Número do bloco de transações, com selo quando o status não é ok. */
function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: Tone;
}) {
  return (
    <div className="py-4 pr-4 lg:px-5 lg:first:pl-0">
      <p className="text-[0.8125rem] font-medium text-ink-2">{label}</p>
      <p className="font-display tabular mt-1.5 text-2xl leading-none font-semibold text-ink">
        {value}
      </p>
      {tone && tone !== "good" && (
        <div className="mt-1">
          <Badge tone={tone}>
            {tone === "critical" ? "Crítico" : "Atenção"}
          </Badge>
        </div>
      )}
    </div>
  );
}

import "server-only";

import type { Tone } from "@/components/ui/primitives";
import { ERROR_EVENTS } from "@/config/cro";

import { fmtDay, fmtInt, fmtPct, fmtPP } from "./format";
import { runFunnel, type FunnelResult } from "./ga4/funnel";
import { croByDimension, type Terms } from "./ga4/kpis";
import { inList, runReport, settle, type QueryContext } from "./ga4/report";
import {
  ATTRIBUTION_ALERT,
  disconnectedSteps,
  eventUsers,
  purchaseAttribution,
  purchaseMeasurementShift,
  transactionQuality,
} from "./quality";
import { defaultFunnel } from "./views";

export type Insight = { tone: Tone; title: string; text: string; href?: string };

const ORDER: Record<Tone, number> = { critical: 0, warning: 1, good: 2, info: 3 };
const pctAbs = (n: number) => fmtPct(Math.abs(n), 0);

/**
 * Alertas por regras simples, escritos como um analista explicaria ao cliente.
 * Cada regra só dispara com volume mínimo, para não tirar conclusão de amostra pequena.
 */
export async function buildInsights(ctx: QueryContext, terms: Terms, compareLabel: string): Promise<Insight[]> {
  const { steps } = await defaultFunnel(ctx);
  const [platforms, devices, newRet, channels, funnelCur, funnelPrev, errors, tx, attribution, stepUsers, shift] = await Promise.all([
    settle(croByDimension(ctx, "platform")),
    settle(croByDimension(ctx, "deviceCategory")),
    settle(croByDimension(ctx, "newVsReturning")),
    settle(croByDimension(ctx, "sessionDefaultChannelGroup")),
    steps.length > 1 ? settle(runFunnel(ctx, steps)) : Promise.resolve(null),
    steps.length > 1 && ctx.comparison ? settle(runFunnel(ctx, steps, { range: ctx.comparison })) : Promise.resolve(null),
    settle(
      runReport(ctx, {
        dimensions: ["eventName"],
        metrics: ["totalUsers"],
        where: inList("eventName", ERROR_EVENTS),
      }),
    ),
    settle(transactionQuality(ctx)),
    settle(purchaseAttribution(ctx)),
    settle(eventUsers(ctx, steps.map((s) => s.event))),
    settle(purchaseMeasurementShift(ctx)),
  ]);

  const out: Insight[] = [];

  // 0. Compras sem origem: quando a maioria das compras não tem canal, as quebras por canal, dispositivo,
  // página e tipo de usuário subestimam a conversão de todo mundo. As regras que dependem disso saem.
  const unattributed = attribution.ok && attribution.data.total >= 20 && attribution.data.share >= ATTRIBUTION_ALERT;
  if (unattributed && attribution.ok) {
    const a = attribution.data;
    out.push({
      tone: "critical",
      title: `${fmtPct(a.share, 0)} das compras chegam sem origem`,
      text: `${fmtInt(a.unattributed)} de ${fmtInt(a.total)} compras não têm canal, página nem dispositivo (aparecem como "Unassigned"). Normalmente é a compra enviada pelo servidor sem o ID do navegador. Com isso, a conversão por canal, dispositivo e página fica subestimada e o funil não liga o checkout à compra.`,
      href: "/qualidade",
    });
  }
  const cut = new Set(funnelCur?.ok && stepUsers.ok ? disconnectedSteps(funnelCur.data.total.steps, stepUsers.data) : []);
  // Compras sem origem só distorcem as quebras quando a meta é compra; o lead mantém a origem.
  const skipBreakdowns = unattributed && !terms.lead;

  // 0b. A forma de medir compras mudou entre os períodos (ex.: o purchase passou do navegador para o
  // servidor e mudou de definição). A variação de compras e conversão deixa de medir mudança de venda.
  const measurementShift = shift.ok ? shift.data : null;
  if (measurementShift) {
    const { cur, prev, since } = measurementShift;
    out.push({
      tone: "warning",
      title: "A medição de compras mudou entre os períodos",
      text: `Compras sem origem: ${fmtPct(prev.share, 0)} antes (${compareLabel}) e ${fmtPct(cur.share, 0)} agora${since ? `, com a mudança a partir de ${fmtDay(since)}` : ""}. Isso indica que a compra passou a ser registrada de outro jeito (outro envio e, em geral, outro momento da compra). A variação de compras, conversão e valor entre os dois períodos não mede mudança real de venda; compare períodos do mesmo lado da mudança.`,
      href: "/qualidade",
    });
  }

  // 1. Conversão geral vs comparação (fora quando a medição de compra mudou e a meta é compra)
  if (platforms.ok) {
    const { cur, prev } = platforms.data.total;
    if (prev && prev.conversion > 0 && cur.sessions >= 1000 && !(measurementShift && !terms.lead)) {
      const change = (cur.conversion - prev.conversion) / prev.conversion;
      if (Math.abs(change) >= 0.1) {
        out.push({
          tone: change > 0 ? "good" : "critical",
          title: `${terms.conversion} ${change > 0 ? "subiu" : "caiu"} ${pctAbs(change)}`,
          text: `${terms.lead ? "A taxa de lead" : "A taxa de conversão em compra"} passou de ${fmtPct(prev.conversion)} para ${fmtPct(cur.conversion)} das sessões (vs ${compareLabel}).`,
        });
      }
    }

    // 2. Diferença entre plataformas (no site, só há "web": usa dispositivo)
    const bigOf = (rows: typeof platforms.data.rows) =>
      rows.filter((r) => r.cur.sessions >= Math.max(1000, cur.sessions * 0.05) && r.value !== "(not set)");
    const byPlatform = bigOf(platforms.data.rows);
    const big = byPlatform.length >= 2 ? byPlatform : devices.ok ? bigOf(devices.data.rows) : [];
    const dimHref = byPlatform.length >= 2 ? "/tecnologia?dim=platform" : "/tecnologia?dim=deviceCategory";
    if (!skipBreakdowns && big.length >= 2) {
      const sorted = [...big].sort((a, b) => b.cur.conversion - a.cur.conversion);
      const best = sorted[0];
      const worst = sorted.at(-1)!;
      const gap = best.cur.conversion ? 1 - worst.cur.conversion / best.cur.conversion : 0;
      if (gap >= 0.2) {
        out.push({
          tone: "warning",
          title: `${worst.value} converte ${pctAbs(gap)} abaixo de ${best.value}`,
          text: `No ${worst.value}, ${fmtPct(worst.cur.conversion)} das sessões terminam em ${terms.goalOne}, contra ${fmtPct(best.cur.conversion)} no ${best.value}. Diferenças assim costumam indicar problema de usabilidade ou bug no ${terms.lead ? "fluxo até o lead" : "fluxo de compra"}.`,
          href: dimHref,
        });
      }
    }
  }

  // 3. Maior perda do funil e 4. mudança de abandono
  if (funnelCur?.ok) {
    const f: FunnelResult = funnelCur.data;
    // Passagens para uma etapa desconectada (ex.: compra enviada pelo servidor) não são abandono real.
    const candidates = f.total.steps.filter((s, i) => s.dropRate !== null && s.users >= 30 && !cut.has(i + 1));
    if (candidates.length) {
      const worst = candidates.reduce((a, b) => ((b.dropRate ?? 0) > (a.dropRate ?? 0) ? b : a));
      const i = f.total.steps.indexOf(worst);
      const next = f.total.steps[i + 1];
      out.push({
        tone: "info",
        title: `Maior perda: ${worst.label} → ${next.label}`,
        text: `${fmtPct(worst.dropRate, 0)} das pessoas que chegam em "${worst.label}" não avançam para "${next.label}" (${fmtInt(worst.users - next.users)} usuários no período). É o ponto do funil com mais espaço para ganho.`,
        href: "/funil",
      });
    }
    if (funnelPrev?.ok) {
      const prevSteps = funnelPrev.data.total.steps;
      let best: { diff: number; i: number } | null = null;
      f.total.steps.forEach((s, i) => {
        const p = prevSteps[i];
        if (s.dropRate === null || p?.dropRate === null || p?.dropRate === undefined) return;
        if (s.users < 50 || p.users < 50 || cut.has(i + 1)) return;
        const diff = s.dropRate - p.dropRate;
        if (Math.abs(diff) >= 0.05 && (!best || Math.abs(diff) > Math.abs(best.diff))) best = { diff, i };
      });
      if (best) {
        const { diff, i } = best as { diff: number; i: number };
        const s = f.total.steps[i];
        out.push({
          tone: diff > 0 ? "critical" : "good",
          title: `Abandono ${diff > 0 ? "subiu" : "caiu"} entre ${s.label} e ${f.total.steps[i + 1].label}`,
          text: `O abandono nessa passagem foi de ${fmtPct(prevSteps[i].dropRate)} para ${fmtPct(s.dropRate)} (${fmtPP(diff)}, vs ${compareLabel}).`,
          href: "/funil",
        });
      }
    }
  }

  // 5. Novos x recorrentes
  if (newRet.ok && !skipBreakdowns) {
    const n = newRet.data.rows.find((r) => r.value === "new");
    const r = newRet.data.rows.find((x) => x.value === "returning");
    if (n && r && n.cur.sessions >= 500 && r.cur.sessions >= 500 && n.cur.conversion > 0 && r.cur.conversion > 0) {
      const ratio = n.cur.conversion / r.cur.conversion;
      if (ratio >= 2 || ratio <= 0.5) {
        const newer = ratio >= 2;
        out.push({
          tone: "info",
          title: newer
            ? `Novos usuários convertem ${ratio.toFixed(1).replace(".", ",")}x mais`
            : `Recorrentes convertem ${(1 / ratio).toFixed(1).replace(".", ",")}x mais`,
          text: newer
            ? `Entre usuários novos, ${fmtPct(n.cur.conversion)} das sessões têm ${terms.goalOne}; entre recorrentes, ${fmtPct(r.cur.conversion)}. Muitas sessões de recorrentes não são de ${terms.goalOne} (uso do produto, consulta), o que dilui a conversão geral.`
            : `Recorrentes convertem ${fmtPct(r.cur.conversion)} das sessões e novos, ${fmtPct(n.cur.conversion)}. A primeira visita pode estar com barreiras (cadastro, confiança, informação).`,
          href: "/novos-recorrentes",
        });
      }
    }
  }

  // 6. Canal com muito tráfego e conversão baixa
  if (channels.ok && !skipBreakdowns) {
    const total = channels.data.total.cur;
    const weak = channels.data.rows
      .filter((r) => total.sessions && r.cur.sessions / total.sessions >= 0.05 && r.cur.conversion <= total.conversion * 0.5)
      .sort((a, b) => b.cur.sessions - a.cur.sessions)[0];
    if (weak) {
      out.push({
        tone: "warning",
        title: `${weak.value}: muito tráfego, ${terms.lead ? "pouco lead" : "pouca compra"}`,
        text: `O canal ${weak.value} traz ${fmtPct(weak.cur.sessions / total.sessions, 0)} das sessões, mas converte ${pctAbs(1 - weak.cur.conversion / total.conversion)} abaixo da média (${fmtPct(weak.cur.conversion)} contra ${fmtPct(total.conversion)}).`,
        href: "/canais",
      });
    }
  }

  // 7. Erros
  if (errors.ok && platforms.ok) {
    const users = platforms.data.total.cur.users;
    const top = errors.data.rows.sort((a, b) => b.cur.totalUsers - a.cur.totalUsers)[0];
    if (top && users) {
      const share = top.cur.totalUsers / users;
      if (share >= 0.05) {
        const prevShare =
          top.prev && platforms.data.total.prev?.users ? top.prev.totalUsers / platforms.data.total.prev.users : null;
        out.push({
          tone: "warning",
          title: `${fmtPct(share, 0)} dos usuários viram "${top.dims.eventName}"`,
          text: `O evento de erro ${top.dims.eventName} atingiu ${fmtInt(top.cur.totalUsers)} pessoas no período${prevShare !== null ? ` (antes: ${fmtPct(prevShare, 0)} dos usuários)` : ""}. Erro durante a jornada derruba a conversão; vale cruzar por tela e versão do app.`,
          href: "/tecnologia?dim=appVersion",
        });
      }
    }
  }

  // 8. Qualidade do purchase
  if (tx.ok && tx.data.purchaseEvents >= 20) {
    const q = tx.data;
    if (q.missingShare >= 0.1 || q.dupIds > 0) {
      out.push({
        tone: q.missingShare >= 0.1 ? "critical" : "warning",
        title: "Tracking de compra com falhas",
        text: `${fmtPct(q.missingShare, 0)} dos eventos de compra chegam sem ID de transação${q.dupIds ? ` e ${fmtInt(q.dupIds)} IDs aparecem repetidos (${fmtInt(q.dupExtra)} disparos extras)` : ""}. Os números de compras e de ${terms.revenue.toLowerCase()} podem estar inflados; vale corrigir antes de usar como meta.`,
        href: "/qualidade",
      });
    }
  }

  return out.sort((a, b) => ORDER[a.tone] - ORDER[b.tone]).slice(0, 7);
}

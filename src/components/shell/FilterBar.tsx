"use client";

import clsx from "clsx";
import { Calendar, Check, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Popover } from "@/components/ui/Popover";
import { fmtDay, fmtRange } from "@/lib/format";
import { regionLabel } from "@/lib/regions";
import {
  COMPARE_MODES,
  FILTERS,
  GOALS,
  PRESETS,
  QUICK_PRESETS,
  activeFilterCount,
  compareLabel,
  type CompareMode,
  type DashboardState,
  type FilterKey,
  type Goal,
  type Preset,
  type Range,
} from "@/lib/state";

import { useDashboardNav } from "./PendingProvider";
import { useStateHref } from "./useStateHref";

type Props = {
  current: Range;
  comparison?: Range;
  today: string;
  options: Partial<Record<FilterKey, string[]>>;
  /** A propriedade tem o evento-chave de lead: mostra o seletor de meta. */
  leadAvailable?: boolean;
};

/** Controles da linha de filtros: pílulas brancas com borda fina, todas da mesma altura. */
export const CONTROL_BASE =
  "flex h-9 items-center gap-2 rounded-full px-3.5 text-sm whitespace-nowrap text-ink transition-colors";
/** Pílula completa, com borda e fundo. O botão de filtros do celular usa só a base para trocar as cores. */
export const CONTROL = `${CONTROL_BASE} border border-line bg-surface hover:bg-active`;

/**
 * Uma linha acima do conteúdo: período (atalhos de semana, mês e 28 dias, e o calendário com a
 * comparação), meta e filtros por dimensão, como campanha e origem / mídia. No celular ficam o
 * período e um botão que mostra o resto.
 */
export function FilterBar({ current, comparison, today, options, leadAvailable }: Props) {
  const { state, hrefFor } = useStateHref();
  const { navigate } = useDashboardNav();
  const [more, setMore] = useState(false);
  const go = (next: DashboardState) => navigate(hrefFor(next));
  const active = activeFilterCount(state);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* A key recria o controle quando o período muda, e as datas do "Personalizado" voltam ao período aplicado. */}
      <PeriodControl key={`${current.start}:${current.end}`} state={state} current={current} today={today} onApply={go} />
      {comparison && (
        <span className="hidden text-xs text-muted 2xl:inline" title={`Comparando com ${fmtRange(comparison)}`}>
          vs {compareLabel(state)} ({shortRange(comparison, today)})
        </span>
      )}

      {leadAvailable && <GoalSwitch goal={state.goal} onChange={(goal) => go({ ...state, goal })} />}

      <button
        type="button"
        aria-expanded={more}
        onClick={() => setMore(!more)}
        className={clsx(CONTROL_BASE, "border md:hidden", active > 0 ? "border-accent bg-accent-wash" : "border-line bg-surface")}
      >
        <SlidersHorizontal size={14} aria-hidden className="opacity-60" />
        Filtros{active > 0 && ` (${active})`}
      </button>

      {/* "contents": no desktop os controles entram direto na linha; no celular só aparecem depois de abrir Filtros. */}
      <div className={clsx("contents", !more && "max-md:hidden")}>
        <span className="mx-1 hidden h-5 w-px bg-control md:block" aria-hidden />

        {FILTERS.filter((f) => options[f.key]?.length).map((f) => (
          <DimensionFilter
            key={f.key}
            label={f.label}
            values={options[f.key] ?? []}
            selected={state.filters[f.key] ?? []}
            format={f.key === "regiao" ? regionLabel : undefined}
            wide={f.key === "campanha" || f.key === "origem"}
            onApply={(vals) => go({ ...state, filters: { ...state.filters, [f.key]: vals } })}
          />
        ))}

        {active > 0 && (
          <button
            type="button"
            onClick={() => go({ ...state, filters: {} })}
            className="flex h-9 items-center gap-1 rounded-full px-2 text-sm text-ink-2 underline-offset-4 hover:text-ink hover:underline"
          >
            <X size={14} aria-hidden /> Limpar filtros
          </button>
        )}
      </div>
    </div>
  );
}

/** Período sem o ano quando é o ano corrente ("9 de out – 5 de nov"), para a linha caber numa linha. */
function shortRange(r: Range, today: string) {
  const year = today.slice(0, 4);
  return r.start.startsWith(year) && r.end.startsWith(year) ? `${fmtDay(r.start)} – ${fmtDay(r.end)}` : fmtRange(r);
}

const PILL = "flex h-7 items-center gap-1.5 rounded-full px-3.5 text-sm whitespace-nowrap transition-colors";
const PILL_ON = "bg-primary font-semibold text-primary-ink";
const PILL_OFF = "text-ink-2 hover:text-ink";

/**
 * Meta de conversão do painel inteiro, sempre à vista (também no celular): troca entre lead e compra
 * com um clique, nos dois sentidos, em vez de um menu escondido.
 */
function GoalSwitch({ goal, onChange }: { goal: Goal; onChange: (g: Goal) => void }) {
  return (
    <div
      role="group"
      aria-label="Meta de conversão"
      title="Evento usado como conversão em todo o painel"
      className="flex h-9 items-center gap-0.5 rounded-full border border-line bg-surface p-1"
    >
      <span className="pr-1 pl-2.5 text-xs font-medium text-muted">Meta</span>
      {GOALS.map((g) => {
        const on = goal === g.id;
        return (
          <button
            key={g.id}
            type="button"
            aria-pressed={on}
            onClick={() => !on && onChange(g.id)}
            className={clsx(PILL, on ? PILL_ON : PILL_OFF)}
          >
            {g.label}
          </button>
        );
      })}
    </div>
  );
}

/** Atalhos em pílulas (semana, mês, 28 dias) e o calendário com os outros períodos e a comparação. */
function PeriodControl({
  state,
  current,
  today,
  onApply,
}: {
  state: DashboardState;
  current: Range;
  today: string;
  onApply: (s: DashboardState) => void;
}) {
  const [start, setStart] = useState(current.start);
  const [end, setEnd] = useState(current.end);
  // Com um atalho ativo, o botão do calendário fica apagado e, no celular, mostra só o ícone.
  const quick = QUICK_PRESETS.some((p) => p.id === state.preset);
  const pick = (preset: Preset) => onApply({ ...state, preset, start: undefined, end: undefined });

  return (
    <div role="group" aria-label="Período" className="flex h-9 items-center gap-0.5 rounded-full border border-line bg-surface p-1">
      {QUICK_PRESETS.map((p) => {
        const on = state.preset === p.id;
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={on}
            title={on ? fmtRange(current) : PRESETS.find((x) => x.id === p.id)?.label}
            onClick={() => !on && pick(p.id)}
            className={clsx(PILL, on ? PILL_ON : PILL_OFF)}
          >
            {p.label}
          </button>
        );
      })}
      <Popover
        width={320}
        buttonClassName={clsx(PILL, quick ? PILL_OFF : PILL_ON)}
        label={
          <span className="flex items-center gap-1.5">
            <Calendar size={14} aria-hidden />
            <span className={quick ? "hidden sm:inline" : undefined}>{shortRange(current, today)}</span>
          </span>
        }
      >
        {(close) => (
          <div>
            <ul role="listbox" aria-label="Período" className="grid grid-cols-2 gap-0.5">
              {PRESETS.filter((p) => p.id !== "custom").map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={state.preset === p.id}
                    onClick={() => {
                      close();
                      pick(p.id);
                    }}
                    className={clsx(
                      "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-raised",
                      state.preset === p.id && "bg-raised font-semibold",
                    )}
                  >
                    {p.label}
                    {state.preset === p.id && <Check size={15} strokeWidth={3} aria-hidden />}
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="mt-1 border-t border-rule px-2 pt-3 pb-1"
              onSubmit={(e) => {
                e.preventDefault();
                close();
                onApply({ ...state, preset: "custom", start, end });
              }}
            >
              <p className="mb-2 text-xs font-medium text-ink-2">Personalizado</p>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  aria-label="Início"
                  value={start}
                  max={today}
                  onChange={(e) => setStart(e.target.value)}
                  className="h-9 min-w-0 flex-1 rounded-lg border border-control bg-surface px-2 text-sm text-ink"
                />
                <span className="text-muted">–</span>
                <input
                  type="date"
                  aria-label="Fim"
                  value={end}
                  max={today}
                  onChange={(e) => setEnd(e.target.value)}
                  className="h-9 min-w-0 flex-1 rounded-lg border border-control bg-surface px-2 text-sm text-ink"
                />
              </div>
              <button
                type="submit"
                disabled={!start || !end}
                className="mt-2 h-9 w-full rounded-full bg-primary text-sm font-semibold text-primary-ink hover:bg-primary-hover disabled:opacity-50"
              >
                Aplicar período
              </button>
            </form>
            <div className="mt-2 border-t border-rule px-2 pt-3 pb-1">
              <p className="mb-2 text-xs font-medium text-ink-2">Comparar com</p>
              <div className="flex flex-wrap gap-1.5">
                {COMPARE_MODES.map((c) => {
                  const on = state.compare === c.id;
                  // "Período anterior" vira "semana anterior" ou "mês anterior" conforme o período escolhido.
                  const label = c.id === "previous" ? compareLabel({ preset: state.preset, compare: "previous" }) : c.label;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        close();
                        if (!on) onApply({ ...state, compare: c.id as CompareMode });
                      }}
                      className={clsx(
                        "h-8 rounded-full border px-3 text-[0.8125rem] first-letter:uppercase",
                        on ? "border-primary bg-primary font-semibold text-primary-ink" : "border-line text-ink hover:bg-raised",
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </Popover>
    </div>
  );
}

/**
 * Filtro de uma dimensão, com vários valores. As marcações ficam num rascunho e valem ao clicar em
 * Aplicar, ao clicar fora ou no botão de novo; Esc descarta. "Só este" aplica um valor de uma vez.
 * Os valores já aplicados aparecem no topo da lista.
 */
function DimensionFilter({
  label,
  values,
  selected,
  onApply,
  format = (v: string) => v,
  wide,
}: {
  label: string;
  values: string[];
  selected: string[];
  onApply: (vals: string[]) => void;
  /** Texto mostrado para cada valor (o filtro usa o valor original). */
  format?: (v: string) => string;
  /** Lista mais larga, para nomes longos (campanha, origem / mídia). */
  wide?: boolean;
}) {
  const [draft, setDraft] = useState<string[]>(selected);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const ordered = useMemo(
    () => [...values.filter((v) => selected.includes(v)), ...values.filter((v) => !selected.includes(v))],
    [values, selected],
  );
  const visible = ordered.filter((v) => !q || v.toLowerCase().includes(q) || format(v).toLowerCase().includes(q));
  const toggle = (v: string) => setDraft((d) => (d.includes(v) ? d.filter((x) => x !== v) : [...d, v]));
  const differs = (vals: string[]) => vals.length !== selected.length || vals.some((v) => !selected.includes(v));
  const apply = (vals: string[]) => {
    if (differs(vals)) onApply(vals);
  };

  return (
    <Popover
      width={wide ? 380 : 300}
      active={selected.length > 0}
      onOpenChange={(open, reason) => {
        // Ao abrir, o rascunho volta ao que está aplicado. Ao fechar por fora, as marcações valem.
        if (open) {
          setDraft(selected);
          setQuery("");
        } else if (reason === "outside" || reason === "toggle") {
          apply(draft);
        }
      }}
      label={
        <span className="max-w-[16rem] truncate">
          {label}
          {selected.length > 0 && (
            <span className="text-ink">: {selected.length === 1 ? format(selected[0]) : `${selected.length} selecionados`}</span>
          )}
        </span>
      }
    >
      {(close) => (
        <div>
          {/* Busca só quando a lista passa de 8 valores. Enter aplica. */}
          {values.length > 8 && (
            <input
              type="search"
              autoFocus
              placeholder={`Buscar ${label.toLowerCase()}`}
              aria-label={`Buscar ${label}`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                close();
                apply(draft);
              }}
              className="mb-1 h-9 w-full rounded-lg border border-control bg-surface px-3 text-sm text-ink"
            />
          )}
          <ul className="thin-scroll max-h-72 overflow-y-auto">
            {visible.map((v) => (
              <li key={v} className="group flex items-center rounded-lg hover:bg-raised">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-2 py-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={draft.includes(v)}
                    onChange={() => toggle(v)}
                    className="size-4 shrink-0 accent-accent"
                  />
                  <span className="truncate" title={format(v)}>
                    {format(v)}
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    apply([v]);
                  }}
                  className="mr-1 shrink-0 rounded-full px-2 py-1 text-xs font-medium text-accent opacity-0 group-hover:opacity-100 hover:underline focus-visible:opacity-100 max-md:opacity-100"
                >
                  Só este
                </button>
              </li>
            ))}
            {!visible.length && <li className="px-2 py-3 text-sm text-muted">Nenhum valor encontrado.</li>}
          </ul>
          <div className="mt-1 flex gap-2 border-t border-rule px-1 pt-2">
            <button
              type="button"
              disabled={!draft.length}
              onClick={() => setDraft([])}
              className="h-9 flex-1 rounded-full border border-line text-sm text-ink hover:bg-raised disabled:opacity-50"
            >
              Limpar
            </button>
            <button
              type="button"
              onClick={() => {
                close();
                apply(draft);
              }}
              className="h-9 flex-1 rounded-full bg-primary text-sm font-semibold text-primary-ink hover:bg-primary-hover"
            >
              Aplicar{draft.length > 0 && ` (${draft.length})`}
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}

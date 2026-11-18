"use client";

import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash } from "lucide-react";
import { useState } from "react";

import { useDashboardNav } from "@/components/shell/PendingProvider";
import { useStateHref } from "@/components/shell/useStateHref";

/** Editor das etapas do funil: escolhe eventos da propriedade, reordena e aplica (vai para a URL). */
export function StepsEditor({
  steps,
  events,
  defaultSteps,
}: {
  steps: string[];
  events: { event: string; count: number }[];
  defaultSteps: string[];
}) {
  const [draft, setDraft] = useState(steps);
  const { state, hrefFor } = useStateHref();
  const { navigate } = useDashboardNav();
  // Igual ao padrão: tira etapas da URL, e o link continua seguindo o funil padrão da propriedade.
  const apply = (list: string[]) =>
    navigate(hrefFor(state, { etapas: list.join(",") === defaultSteps.join(",") ? undefined : list.join(",") }));

  const move = (i: number, d: number) =>
    setDraft((s) => {
      const n = [...s];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    });

  return (
    <div className="space-y-2">
      <ol className="space-y-1.5">
        {draft.map((ev, i) => (
          <li key={`${ev}-${i}`} className="flex items-center gap-2">
            <span className="w-5 text-right text-xs text-muted tabular">{i + 1}.</span>
            <select
              aria-label={`Evento da etapa ${i + 1}`}
              value={ev}
              onChange={(e) => setDraft((s) => s.map((x, j) => (j === i ? e.target.value : x)))}
              className="h-8 min-w-0 flex-1 rounded-full bg-raised px-3 text-sm text-ink"
            >
              {/* Evento da URL fora do inventário de 90 dias: entra como opção para o select não trocar de valor sozinho. */}
              {!events.some((e) => e.event === ev) && <option value={ev}>{ev}</option>}
              {events.map((e) => (
                <option key={e.event} value={e.event}>
                  {e.event}
                </option>
              ))}
            </select>
            <button type="button" aria-label="Subir etapa" disabled={i === 0} onClick={() => move(i, -1)} className="p-1 text-ink-2 disabled:opacity-30">
              <ArrowUp size={14} aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Descer etapa"
              disabled={i === draft.length - 1}
              onClick={() => move(i, 1)}
              className="p-1 text-ink-2 disabled:opacity-30"
            >
              <ArrowDown size={14} aria-hidden />
            </button>
            {/* Funil precisa de pelo menos duas etapas. */}
            <button
              type="button"
              aria-label="Remover etapa"
              disabled={draft.length <= 2}
              onClick={() => setDraft((s) => s.filter((_, j) => j !== i))}
              className="p-1 text-ink-2 disabled:opacity-30"
            >
              <Trash size={14} aria-hidden />
            </button>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2 pt-1">
        {/* Até 10 etapas, o mesmo corte que a página aplica ao ler a URL. A nova etapa começa no evento de maior volume. */}
        <button
          type="button"
          disabled={draft.length >= 10}
          onClick={() => setDraft((s) => [...s, events[0]?.event ?? "purchase"])}
          className="flex h-8 items-center gap-1 rounded-full border border-line px-2.5 text-sm text-ink-2 hover:text-ink disabled:opacity-40"
        >
          <Plus size={14} aria-hidden /> Etapa
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(defaultSteps);
            apply(defaultSteps);
          }}
          className="flex h-8 items-center gap-1 rounded-full px-2.5 text-sm text-ink-2 hover:text-ink"
        >
          <RotateCcw size={14} aria-hidden /> Padrão
        </button>
        <button
          type="button"
          onClick={() => apply(draft)}
          className="ml-auto h-8 rounded-full bg-primary px-4 text-sm font-semibold text-primary-ink hover:bg-primary-hover"
        >
          Aplicar funil
        </button>
      </div>
    </div>
  );
}

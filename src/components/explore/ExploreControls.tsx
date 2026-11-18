"use client";

import { Plus, X } from "lucide-react";
import { useId, useState } from "react";

import { useDashboardNav } from "@/components/shell/PendingProvider";
import { useStateHref } from "@/components/shell/useStateHref";

/**
 * Controles da página Explorar. As escolhas ficam num rascunho local e só vão para a URL
 * (d1, d2 e m) ao aplicar, para não disparar uma consulta ao GA4 a cada mudança.
 */

/** Campo do getMetadata pronto para o seletor: id é o apiName, label é o nome mostrado na tela. */
export type FieldOption = { id: string; label: string; category: string };

/** Seletor de dimensões e métricas da exploração livre. Só aceita nomes que existem no getMetadata. */
export function ExploreControls({
  max,
  dimensions,
  metrics,
  d1,
  d2,
  selected,
  shortcuts,
}: {
  max: number;
  dimensions: FieldOption[];
  metrics: FieldOption[];
  d1: string;
  d2?: string;
  selected: string[];
  shortcuts: { label: string; d1: string; d2?: string; m: string[] }[];
}) {
  const { state, hrefFor } = useStateHref();
  const { navigate } = useDashboardNav();
  const [dim1, setDim1] = useState(d1);
  const [dim2, setDim2] = useState(d2 ?? "");
  const [ms, setMs] = useState(selected);
  const [draft, setDraft] = useState("");
  const ids = { d1: useId(), d2: useId(), m: useId(), dl1: useId(), dl2: useId() };

  const dimIds = new Set(dimensions.map((d) => d.id));
  const metIds = new Set(metrics.map((m) => m.id));
  const label = (list: FieldOption[], id: string) => list.find((f) => f.id === id)?.label ?? id;

  // Aplicar só habilita com uma combinação válida (a quebra não pode repetir a principal) e diferente da URL.
  const valid = dimIds.has(dim1) && (!dim2 || (dimIds.has(dim2) && dim2 !== dim1)) && ms.length > 0;
  const dirty = dim1 !== d1 || dim2 !== (d2 ?? "") || ms.join(",") !== selected.join(",");

  const addMetric = (raw: string) => {
    const id = raw.trim();
    if (!metIds.has(id) || ms.includes(id) || ms.length >= max) return;
    setMs([...ms, id]);
    setDraft("");
  };

  const go = (next: { d1: string; d2?: string; m: string[] }) =>
    navigate(hrefFor(state, { d1: next.d1, d2: next.d2 || undefined, m: next.m.join(",") }));

  const input =
    "h-9 w-full rounded-full bg-raised px-3.5 text-sm text-ink placeholder:text-muted";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-2">Atalhos:</span>
        {shortcuts.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => {
              // Atalho aplica direto. O rascunho muda junto para os campos não mostrarem a escolha antiga enquanto carrega.
              setDim1(s.d1);
              setDim2(s.d2 ?? "");
              setMs(s.m);
              go(s);
            }}
            className="h-7 rounded-full border border-line px-3 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor={ids.d1} className="mb-1 block text-xs font-medium text-ink-2">
            Dimensão principal
          </label>
          <input
            id={ids.d1}
            list={ids.dl1}
            value={dim1}
            onChange={(e) => setDim1(e.target.value.trim())}
            className={input}
            placeholder="Digite para buscar (ex.: canal, tela, versão)"
          />
          <p className="mt-1 truncate text-xs text-muted">{dimIds.has(dim1) ? label(dimensions, dim1) : "Escolha uma dimensão da lista"}</p>
        </div>
        <div>
          <label htmlFor={ids.d2} className="mb-1 block text-xs font-medium text-ink-2">
            Quebra secundária (opcional)
          </label>
          <div className="flex gap-2">
            <input
              id={ids.d2}
              list={ids.dl2}
              value={dim2}
              onChange={(e) => setDim2(e.target.value.trim())}
              className={input}
              placeholder="Nenhuma"
            />
            {dim2 && (
              <button
                type="button"
                aria-label="Remover quebra secundária"
                onClick={() => setDim2("")}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-raised text-ink-2 hover:bg-active"
              >
                <X size={14} aria-hidden />
              </button>
            )}
          </div>
          <p className="mt-1 truncate text-xs text-muted">
            {!dim2 ? "Sem quebra" : dim2 === dim1 ? "Igual à dimensão principal" : dimIds.has(dim2) ? label(dimensions, dim2) : "Escolha uma dimensão da lista"}
          </p>
        </div>
      </div>

      <div>
        <label htmlFor={ids.m} className="mb-1 block text-xs font-medium text-ink-2">
          Métricas ({ms.length}/{max})
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          {ms.map((m) => (
            <span key={m} className="inline-flex h-7 items-center gap-1 rounded-full border border-line bg-surface-2 pr-1 pl-2.5 text-xs text-ink">
              {label(metrics, m)}
              <button
                type="button"
                aria-label={`Remover ${label(metrics, m)}`}
                onClick={() => setMs(ms.filter((x) => x !== m))}
                className="grid h-5 w-5 place-items-center rounded-full text-ink-2 hover:bg-surface hover:text-ink"
              >
                <X size={12} aria-hidden />
              </button>
            </span>
          ))}
          {ms.length < max && (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                addMetric(draft);
              }}
            >
              <input
                id={ids.m}
                list={ids.m + "-list"}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  // Escolher no datalist já preenche o apiName exato: adiciona sem precisar de Enter.
                  if (metIds.has(e.target.value.trim())) addMetric(e.target.value);
                }}
                className={`${input} h-7 w-56 text-xs`}
                placeholder="Adicionar métrica"
              />
              <button
                type="submit"
                aria-label="Adicionar métrica"
                className="grid h-7 w-7 place-items-center rounded-full text-ink-2 hover:bg-active"
              >
                <Plus size={14} aria-hidden />
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!valid || !dirty}
          onClick={() => go({ d1: dim1, d2: dim2, m: ms })}
          className="h-9 rounded-full bg-primary px-5 text-sm font-semibold text-primary-ink hover:bg-primary-hover disabled:opacity-40"
        >
          Aplicar
        </button>
        {!valid && <span className="text-xs text-warning-ink">Escolha uma dimensão válida e pelo menos uma métrica.</span>}
      </div>

      <datalist id={ids.dl1}>
        {dimensions.map((d) => (
          <option key={d.id} value={d.id}>{`${d.label} · ${d.category}`}</option>
        ))}
      </datalist>
      <datalist id={ids.dl2}>
        {dimensions.map((d) => (
          <option key={d.id} value={d.id}>{`${d.label} · ${d.category}`}</option>
        ))}
      </datalist>
      <datalist id={ids.m + "-list"}>
        {metrics
          .filter((m) => !ms.includes(m.id))
          .map((m) => (
            <option key={m.id} value={m.id}>{`${m.label} · ${m.category}`}</option>
          ))}
      </datalist>
    </div>
  );
}

"use client";

import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

/** Como o painel fechou: botão de novo, clique fora, Esc ou uma ação de dentro (close). */
export type CloseReason = "toggle" | "outside" | "escape" | "close";

/** Botão com painel suspenso; fecha com clique fora ou Esc. */
export function Popover({
  label,
  active,
  children,
  align = "left",
  width = 280,
  open: controlledOpen,
  onOpenChange,
  buttonClassName,
  showChevron = true,
}: {
  label: React.ReactNode;
  active?: boolean;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  align?: "left" | "right";
  width?: number;
  open?: boolean;
  onOpenChange?: (open: boolean, reason?: CloseReason) => void;
  /** Substitui o estilo padrão do botão (ex.: dentro de um grupo de pílulas). */
  buttonClassName?: string;
  showChevron?: boolean;
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlledOpen ?? innerOpen;
  // O clique fora é ouvido por um efeito criado ao abrir: o ref garante que ele chame o onOpenChange
  // mais recente (com as marcações atuais de quem usa o Popover), não o daquele momento.
  const changeRef = useRef(onOpenChange);
  useLayoutEffect(() => {
    changeRef.current = onOpenChange;
  });
  const setOpen = (v: boolean, reason?: CloseReason) => {
    setInnerOpen(v);
    changeRef.current?.(v, v ? undefined : reason);
  };
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false, "outside");
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false, "escape");
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => setOpen(false, "close");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open, "toggle")}
        className={
          buttonClassName ??
          clsx(
            "flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm whitespace-nowrap text-ink transition-colors",
            active ? "border-accent bg-accent-wash" : "border-line bg-surface hover:bg-active",
          )
        }
      >
        {label}
        {showChevron && <ChevronDown size={14} aria-hidden className="opacity-60" />}
      </button>
      {open && (
        // Painel suspenso (sobreposição de verdade): a sombra separa do conteúdo.
        <div
          id={id}
          role="dialog"
          style={{ width }}
          className={clsx(
            "absolute z-30 mt-2 max-w-[calc(100vw-2rem)] rounded-xl bg-surface p-2 shadow-[0_0_0_1px_var(--border),0_16px_40px_-12px_rgba(18,36,53,0.25)]",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

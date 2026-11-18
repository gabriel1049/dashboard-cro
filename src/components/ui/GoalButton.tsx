"use client";

import { ArrowRight } from "lucide-react";

import { useDashboardNav } from "@/components/shell/PendingProvider";
import { useStateHref } from "@/components/shell/useStateHref";
import type { Goal } from "@/lib/state";

/** Troca a meta do painel inteiro (ex.: "Ver por lead" no aviso de compras sem origem). */
export function GoalButton({
  goal,
  children,
  variant = "link",
}: {
  goal: Goal;
  children: React.ReactNode;
  variant?: "link" | "button";
}) {
  const { state, hrefFor } = useStateHref();
  const { navigate } = useDashboardNav();
  return (
    <button
      type="button"
      onClick={() => navigate(hrefFor({ ...state, goal }))}
      className={
        variant === "button"
          ? "no-export mt-4 inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-ink hover:bg-primary-hover"
          : "no-export mt-1.5 inline-flex items-center gap-1 text-xs text-accent hover:underline"
      }
    >
      {children} <ArrowRight size={variant === "button" ? 14 : 12} aria-hidden />
    </button>
  );
}

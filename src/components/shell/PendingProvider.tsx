"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useTransition } from "react";

type Nav = { navigate: (href: string) => void; pending: boolean };

const NavContext = createContext<Nav>({ navigate: () => {}, pending: false });

/**
 * Navegação de filtros como transição: enquanto os dados novos carregam, o painel
 * mantém o quadro anterior apagado (sem skeleton, sem pulo de layout).
 */
export function PendingProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const navigate = useCallback(
    (href: string) => startTransition(() => router.push(href, { scroll: false })),
    [router],
  );
  return (
    <NavContext value={{ navigate, pending }}>
      <div data-pending={pending} aria-busy={pending}>
        {children}
      </div>
    </NavContext>
  );
}

export const useDashboardNav = () => useContext(NavContext);

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SESSION_COOKIE } from "@/lib/auth";

/** Encerra a sessão deste navegador e volta para o login. */
export async function POST() {
  // Só POST (o botão de sair é um formulário): link ou prefetch não encerram a sessão sem querer.
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

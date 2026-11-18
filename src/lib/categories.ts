/**
 * Categoria de produto e tipo de página, tirados do caminho da página de entrada.
 * O GA4 do site não tem a categoria nos eventos do simulador (produto_categoria só vem nos
 * eventos antigos), mas a página de entrada diz qual produto a pessoa veio ver. As regras são
 * prefixos de caminho; o que não casa com nenhuma fica em "Sem categoria" / "Institucional".
 */

export const CATEGORIES = ["Imóveis", "Automóveis", "Motos", "Outros produtos", "Sem categoria"] as const;
export type Category = (typeof CATEGORIES)[number];

export const PAGE_TYPES = [
  "Home",
  "Página de produto",
  "Página de consórcio",
  "Oferta e campanha",
  "Conteúdo (blog)",
  "Institucional",
] as const;
export type PageType = (typeof PAGE_TYPES)[number];

const CATEGORY_RULES: [RegExp, Category][] = [
  [/^\/(produtos\/imove|consorcio\/imove|cupom-imove|consorcio\/construcao)/, "Imóveis"],
  [/^\/(produtos\/auto|consorcio\/carro|consorcio\/auto|cupom-auto|carro-eletrico|rota99)/, "Automóveis"],
  [/^\/(produtos\/moto|consorcio\/moto|cupom-moto|moto99)/, "Motos"],
  [/^\/(produtos|consorcio)\//, "Outros produtos"],
];

const TYPE_RULES: [RegExp, PageType][] = [
  [/^\/$/, "Home"],
  [/^\/produtos\//, "Página de produto"],
  [/^\/consorcio\//, "Página de consórcio"],
  [/^\/(cupom-|moto99|rota99|carro-eletrico|sonhadores|black-?friday|lp-)/, "Oferta e campanha"],
  [/^\/blog\//, "Conteúdo (blog)"],
];

/** Regras em texto, para a legenda da seção (o que entra em cada grupo). */
export const CATEGORY_HELP: Record<Category, string> = {
  Imóveis: "/produtos/imoveis, /consorcio/imoveis, /cupom-imovel, construção e reforma",
  Automóveis: "/produtos/auto, /consorcio/carros, /cupom-auto, /carro-eletrico, /rota99",
  Motos: "/consorcio/motos, /moto99",
  "Outros produtos": "demais /consorcio/ e /produtos/ (serviços, máquinas, quitar financiamento)",
  "Sem categoria": "home, institucionais, blog e páginas sem produto",
};

export function isLandingPath(path: string | undefined): path is string {
  return Boolean(path && path.startsWith("/"));
}

export function classifyPage(path: string): { category: Category; type: PageType } {
  const p = path.toLowerCase().split("?")[0];
  const category = CATEGORY_RULES.find(([re]) => re.test(p))?.[1] ?? "Sem categoria";
  const type = TYPE_RULES.find(([re]) => re.test(p))?.[1] ?? "Institucional";
  return { category, type };
}

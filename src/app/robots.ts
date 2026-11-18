import type { MetadataRoute } from "next";

/** Painel interno: nada aqui deve aparecer em busca. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}

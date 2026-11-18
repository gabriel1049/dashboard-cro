import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O cliente oficial do GA4 usa gRPC e carrega arquivos .proto em tempo de execução:
  // fica fora do bundle e é resolvido direto do node_modules no servidor.
  serverExternalPackages: ["@google-analytics/data", "google-gax", "@grpc/grpc-js"],
  // Saída enxuta para deploy em servidor Node (Hostinger, VPS).
  output: "standalone",
  poweredByHeader: false,
  // Painel interno com dados do cliente: fora da busca, sem moldura de outro site, sem vazar a URL.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;

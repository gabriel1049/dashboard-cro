import type { ReportMeta } from "@/lib/ga4/report";

import { Notice } from "./primitives";

/** Aviso quando o GA4 aplicou limites que afetam os números do bloco ou da página. */
export function MetaNotice({ meta }: { meta: ReportMeta }) {
  const items: string[] = [];
  if (meta.thresholding) {
    items.push(
      "O GA4 aplicou limite de privacidade (thresholding): linhas com poucos usuários foram omitidas e os totais podem ficar abaixo do real.",
    );
  }
  if (meta.otherRow) {
    items.push(
      "Há uma linha \"(other)\": a dimensão passou do limite de valores únicos do GA4 e parte dos dados foi agrupada.",
    );
  }
  if (meta.sampled) items.push("Os dados foram amostrados pelo GA4.");
  if (meta.restricted.length) {
    items.push(`A credencial não tem acesso a algumas métricas: ${meta.restricted.join(", ")}.`);
  }
  if (!items.length) return null;
  return (
    <Notice tone="warning" title="Dados impactados por limites do GA4">
      <ul className="list-disc space-y-0.5 pl-4">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </Notice>
  );
}

/**
 * Nome das regiões em português. O GA4 devolve os estados em inglês e sem acento
 * ("State of Sao Paulo", "Federal District"); o filtro continua usando o valor original.
 */
const ACCENTS: Record<string, string> = {
  "Sao Paulo": "São Paulo",
  Parana: "Paraná",
  Goias: "Goiás",
  "Espirito Santo": "Espírito Santo",
  Ceara: "Ceará",
  Para: "Pará",
  "Federal District": "Distrito Federal",
  Maranhao: "Maranhão",
  Paraiba: "Paraíba",
  Piaui: "Piauí",
  Rondonia: "Rondônia",
  Amapa: "Amapá",
};

export function regionLabel(value: string): string {
  const name = value.replace(/^State of /, "");
  return ACCENTS[name] ?? name;
}

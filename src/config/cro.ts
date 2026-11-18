/**
 * Definições de CRO do dashboard. Tudo aqui é validado contra o getMetadata e o
 * inventário de eventos antes de virar consulta: o que não existe na propriedade é omitido.
 */
import type { FunnelStepDef } from "@/lib/ga4/funnel";

/** Funil padrão de e-commerce do GA4 (etapas sem volume na propriedade são removidas). */
export const ECOMMERCE_FUNNEL: FunnelStepDef[] = [
  { label: "Ver item", event: "view_item" },
  { label: "Adicionar ao carrinho", event: "add_to_cart" },
  { label: "Iniciar checkout", event: "begin_checkout" },
  { label: "Informar entrega", event: "add_shipping_info" },
  { label: "Informar pagamento", event: "add_payment_info" },
  { label: "Compra", event: "purchase" },
];

/** Funil do site de consórcio: simulação, lead, escolha do plano (grupo), checkout e compra. */
export const SIMULATION_FUNNEL: FunnelStepDef[] = [
  { label: "Iniciar simulação", event: "iniciar_simulacao" },
  { label: "Lead gerado", event: "generate_lead" },
  { label: "Ver planos", event: "view_item_list" },
  { label: "Escolher plano", event: "select_item" },
  { label: "Iniciar checkout", event: "begin_checkout" },
  { label: "Informar pagamento", event: "add_payment_info" },
  { label: "Compra", event: "purchase" },
];

/**
 * Funis candidatos. Em cada propriedade vale o que tiver a maior parte dos eventos com volume
 * (empate: o primeiro). Assim o app usa o funil de e-commerce e o site o de simulação.
 */
export const FUNNEL_PRESETS: FunnelStepDef[][] = [ECOMMERCE_FUNNEL, SIMULATION_FUNNEL];

export const EVENT_LABELS: Record<string, string> = Object.fromEntries(
  [
    ...ECOMMERCE_FUNNEL,
    ...SIMULATION_FUNNEL,
    { label: "Lista de itens", event: "view_item_list" },
    { label: "Início de sessão", event: "session_start" },
  ].map((s) => [s.event, s.label]),
);

/** Eventos que indicam erro ou travamento (usados em Tecnologia, Telas e Insights). */
export const ERROR_EVENTS = (process.env.CRO_ERROR_EVENTS ?? "erro_sistema,app_exception")
  .split(",")
  .map((e) => e.trim())
  .filter(Boolean);

/** Eventos que normalmente não deveriam ser eventos-chave (conversões). */
export const NOT_CONVERSIONS = [
  "session_start",
  "first_visit",
  "first_open",
  "page_view",
  "screen_view",
  "user_engagement",
  "scroll",
  "view_item_list",
  "view_item",
  "select_item",
  "add_to_cart",
  "login",
  "app_update",
  "os_update",
];

/** Quebras disponíveis para o funil (validadas no metadata). Campanha e origem primeiro, como pede o briefing. */
export const FUNNEL_BREAKDOWNS = [
  { id: "sessionCampaignName", label: "Campanha" },
  { id: "sessionSourceMedium", label: "Origem / mídia" },
  { id: "landingPage", label: "Página de entrada" },
  { id: "sessionDefaultChannelGroup", label: "Canal" },
  { id: "hostName", label: "Simulador" },
  { id: "deviceCategory", label: "Dispositivo" },
  { id: "newVsReturning", label: "Novos x recorrentes" },
  { id: "platform", label: "Plataforma" },
];

/**
 * Jornada do simulador medida por um evento macro: etapa_simulacao, com o nome da etapa no
 * parâmetro nome_etapa. Cada etapa do funil é o mesmo evento com um valor do parâmetro, na ordem
 * das telas do simulador. Valores sem volume na propriedade saem do funil.
 */
export const JOURNEY = {
  event: process.env.CRO_JOURNEY_EVENT?.trim() || "etapa_simulacao",
  param: process.env.CRO_JOURNEY_PARAM?.trim() || "nome_etapa",
  steps: [
    { value: "home", label: "Início da simulação" },
    { value: "queremos te conhecer", label: "Queremos te conhecer" },
    { value: "informe sua renda", label: "Informe sua renda" },
    { value: "planos pensados para você", label: "Planos para você" },
    { value: "detalhes do plano escolhido", label: "Detalhes do plano" },
    { value: "identificacao", label: "Identificação" },
    { value: "dados da proposta", label: "Dados da proposta" },
    { value: "confirme seus dados", label: "Confirme seus dados" },
    { value: "resumo", label: "Resumo" },
  ],
  /** Telas de saída: não são etapas, explicam parte da perda entre duas etapas. */
  exits: [{ value: "nenhum plano disponivel para a renda informada", label: "Nenhum plano para a renda informada", after: "informe sua renda" }],
};

/** Simulador usado (subdomínio): mostra a categoria de produto do lado do simulador. */
export const SIMULATOR_LABELS: Record<string, string> = {
  "simulador.mycon.com.br": "Simulador geral",
  "simulador-imovel.mycon.com.br": "Simulador de imóvel",
  "simulador-auto.mycon.com.br": "Simulador de auto",
  "simulador-performance.mycon.com.br": "Simulador performance",
  "simule-99.mycon.com.br": "Simule 99 (motoristas)",
  "simule-app.mycon.com.br": "Simule app",
};

/** Dimensões da seção Dispositivo e tecnologia (as que não existirem somem). */
export const TECH_DIMENSIONS = [
  { id: "deviceCategory", label: "Dispositivo" },
  { id: "platform", label: "Plataforma" },
  { id: "operatingSystem", label: "Sistema operacional" },
  { id: "operatingSystemWithVersion", label: "Versão do sistema" },
  { id: "appVersion", label: "Versão do app" },
  { id: "mobileDeviceModel", label: "Modelo do aparelho" },
  { id: "browser", label: "Navegador" },
  { id: "screenResolution", label: "Resolução de tela" },
];

export const CHANNEL_DIMENSIONS = [
  { id: "sessionDefaultChannelGroup", label: "Canal" },
  { id: "sessionSourceMedium", label: "Origem / mídia" },
  { id: "sessionCampaignName", label: "Campanha" },
];

export const PRODUCT_DIMENSIONS = [
  { id: "itemName", label: "Item" },
  { id: "itemCategory", label: "Categoria" },
  { id: "itemId", label: "ID do item" },
];

/** Volume mínimo para uma linha entrar nas regras de alerta (evita conclusões com pouca amostra). */
export const MIN_SESSIONS_FOR_ALERT = 500;

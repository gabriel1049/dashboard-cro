# Dashboard de CRO (GA4 Data API)

Painel web de CRO que substitui o Looker Studio. Lê os dados direto da Google Analytics Data API (somente leitura), com filtro de período, comparação automática, filtros globais, exploração livre, exportação em CSV e HTML.

- **Front e servidor:** Next.js 16 (App Router) + React 19 + TypeScript. As consultas ao GA4 rodam no servidor; o navegador nunca vê credenciais.
- **Gráficos:** ECharts (renderização SVG, para que a exportação HTML leve os gráficos). **Tabelas:** TanStack Table.
- **Laboratório Python** (`lab/`): login OAuth e inventário da conta (`check`). Útil também para análises pontuais em pandas.

## Seções

| Rota | O que mostra |
|---|---|
| `/` Visão geral | Insights automáticos (regras em linguagem simples), KPIs com variação, tendência diária e plataformas |
| `/funil` | Funil fechado do GA4 (`runFunnelReport` v1alpha, com fallback) com quebra por plataforma, dispositivo, canal, novo x recorrente ou SO; etapas editáveis |
| `/tecnologia` | Conversão, abandono de checkout e erros por dispositivo, SO, versão, aparelho; marca combinações com cara de bug |
| `/paginas` | Site: páginas de entrada com matriz de oportunidade. App: telas, com matriz de erros por tela |
| `/canais` | Canal, origem/mídia e campanha: participação nas sessões x nas compras (ou nos leads) e tabela completa |
| `/produtos` | Itens vistos, adicionados e comprados, com alertas de "muito visto, pouco adicionado" |
| `/perfil` | Idade e gênero: participação no público x nos leads ou compras, com o índice de conversão de cada faixa |
| `/categorias` | Páginas de entrada agrupadas por categoria de produto e por tipo de página |
| `/novos-recorrentes` | Comparação lado a lado e funil por tipo de usuário |
| `/qualidade` | Saúde do tracking: transaction_id ausente ou repetido, (not set), coerência do funil, quedas diárias, eventos-chave suspeitos |
| `/explorar` | Tabela livre: até 2 dimensões e 10 métricas de qualquer campo do `getMetadata` |

Todos os filtros ficam na URL (`?periodo=last7&plataforma=Android&...`), então qualquer visão pode ser compartilhada por link. Clicar num valor de tabela ou numa barra aplica o filtro no painel inteiro.

## Rodar localmente

Requisitos: Node 20.9+ (testado no 24), Python 3.11+ (só para o login) e uma conta Google com acesso de Leitor (ou mais) às propriedades do GA4.

1. Instale as dependências e crie o `.env`:

```bash
npm install
cp .env.example .env          # Windows (cmd/PowerShell): copy .env.example .env
```

O `.env.example` já vem com as propriedades (Site e App) e os rótulos usados em produção. Só falta a credencial do GA4.

2. Gere a credencial seguindo a seção [Credencial do GA4](#credencial-do-ga4) (OAuth com a sua conta ou Service Account).

3. Rode o painel:

```bash
npm run dev
```

Abra http://localhost:3000. Em desenvolvimento, sem `DASHBOARD_PASSWORD` no `.env`, a tela de login fica desligada. Sem credencial, cada bloco do painel mostra o que falta configurar.

Outros comandos: `npm run typecheck`, `npm run build`, `npm start`.

No `npm install`, o npm 11 avisa que o `postinstall` do `protobufjs` não rodou. Pode ignorar: esse script só imprime um aviso de versão.

## Credencial do GA4

O painel usa o escopo `analytics.readonly`. Há dois caminhos:

| Modo | Quem acessa o GA4 | Precisa de Administrador na propriedade? |
|---|---|---|
| OAuth | A sua conta Google | Não. Basta ter acesso de Leitor, Analista ou Editor. |
| Service Account | Uma conta de serviço | Sim. Um Administrador precisa adicioná-la como Leitor. |

### OAuth com a sua conta (configuração atual)

Feito uma vez no [Google Cloud Console](https://console.cloud.google.com/):

1. Projeto com a **Google Analytics Data API** ativada (APIs e serviços > Biblioteca).
2. Tela de consentimento (Google Auth Platform): público Externo ou Interno; em Usuários de teste, o e-mail que enxerga a propriedade no GA4.
3. Clientes > Criar cliente > **Aplicativo da Web**, com `http://localhost:8080/` em "URIs de redirecionamento autorizados". Baixe o JSON e salve como `credentials/client_secret.json`.
4. Login (abre o navegador), a partir da raiz do projeto:

```bash
python -m venv .venv
source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r lab/requirements.txt
cd lab
python -m ga4cro login
python -m ga4cro check
```

O `login` grava `credentials/token.json`, que o Next.js lê. O `check` mostra o inventário da conta (eventos, métricas, restrições) e salva `output/discovery_<id>.json`.

**Token que expira em 7 dias:** com o app OAuth em modo Teste e público Externo, o Google invalida o token toda semana e o painel passa a mostrar "login expirado". Para evitar, clique em **Publicar app** na tela de Público (o aviso de "app não verificado" no login é normal para uso interno). Se acontecer, rode o `login` de novo.

### Service Account (recomendado para produção)

1. No mesmo projeto: IAM > Contas de serviço > Criar; depois Chaves > Adicionar chave > JSON.
2. Um Administrador da propriedade adiciona o e-mail da conta de serviço como **Leitor** no GA4.
3. Salve a chave em `credentials/service_account.json` ou passe o conteúdo em `GA4_SERVICE_ACCOUNT_JSON`.

Não depende do login de uma pessoa nem expira.

## Publicar (Hostinger ou outro host Node)

O build gera um servidor Node autocontido (`output: "standalone"`):

```powershell
npm run build
```

Envie para o servidor a pasta `.next/standalone`, mais `.next/static` (em `.next/standalone/.next/static`) e inicie com `node server.js` (porta pela variável `PORT`). Num VPS, rode com PM2 atrás do Nginx.

Na Hostinger (deploy de app Node pelo hPanel), use o script `build:hostinger`, que roda `next build --webpack`: o Turbopack falha nos servidores de build de lá.

Variáveis no servidor (nunca suba os arquivos de `credentials/`):

- `GA4_PROPERTIES` (ou `GA4_PROPERTY_ID` + `GA4_PROPERTY_LABEL`), `GA4_TIME_ZONE`, `GA4_AUTH_MODE`, `CRO_*`
- Credencial: `GA4_SERVICE_ACCOUNT_JSON` **ou** `GA4_OAUTH_CLIENT_ID` + `GA4_OAUTH_CLIENT_SECRET` + `GA4_OAUTH_REFRESH_TOKEN` (copie do `credentials/token.json`)
- Acesso: `DASHBOARD_PASSWORD` e `DASHBOARD_SECRET`

**Acesso ao painel.** Todas as páginas e a API passam pelo `src/proxy.ts`: sem sessão, a pessoa vai para `/login`. A senha é única para a equipe (`DASHBOARD_PASSWORD`) e a sessão fica num cookie assinado com HMAC por 14 dias (`DASHBOARD_SECRET`; trocar a chave derruba todas as sessões). Em produção, sem `DASHBOARD_PASSWORD` ninguém entra: a tela de login avisa que o acesso não foi configurado. As páginas saem com `noindex`.

## Como os dados são tratados

- **Nomes validados:** toda consulta confere dimensões e métricas no `getMetadata` antes de chamar a API. Nada é escrito "de cabeça".
- **Várias propriedades:** `GA4_PROPERTIES` (formato `id=nome|fuso;...`) liga o seletor de propriedade no painel. Hoje: Site (314161581, padrão) e App (469824674).
- **Funil padrão:** escolhido pelos eventos da propriedade. Se houver `iniciar_simulacao`, `generate_lead` etc., usa o funil de simulação; senão, o de e-commerce do GA4. Dá para editar as etapas na página do funil.
- **Conversão:** `sessionKeyEventRate:purchase` (sessões com compra ÷ sessões), que não infla com compra duplicada. Cai para compras ÷ sessões quando o purchase não é evento-chave ou quando 30% ou mais das compras chegam sem origem (purchase enviado pelo servidor sem o ID do navegador), porque aí a taxa por sessão vai a zero sem a venda ter caído.
- **Compras sem origem:** o painel avisa nas quebras por canal, dispositivo, página e tipo de usuário, marca a etapa de compra como "desconectada" no funil e tira essas regras dos insights.
- **Meta: Compra | Lead:** seletor na barra de filtros (`?meta=lead` na URL) que troca a conversão do painel inteiro. Na meta Lead, a conversão é `sessionKeyEventRate:<evento>` (sessões com lead ÷ sessões) e a contagem é `keyEvents:<evento>`; o evento vem de `CRO_LEAD_EVENT` (padrão `generate_lead`). Visão geral, canais, tecnologia, páginas, novos x recorrentes e insights passam a usar leads; as colunas de crédito e ticket saem das tabelas porque são do purchase. O seletor só aparece quando o evento é evento-chave na propriedade (hoje, só no Site); em outra propriedade a meta volta para compra. Como o lead mantém a origem, é a meta indicada para analisar canais e páginas enquanto as compras chegam sem origem, e o aviso de compras sem origem traz o atalho "Ver por lead". O GA4 não recalcula eventos-chave para trás: no Site, o `generate_lead` só conta como evento-chave desde 13/10/2026, e o painel avisa quando o período atual ou o de comparação começa antes disso (a variação fica sem base).
- **Comparação:** período anterior de mesmo tamanho ou ano anterior; os períodos terminam ontem (hoje ainda está incompleto).
- **Cache:** em memória no servidor, 20 min para períodos recentes, 6 h para períodos fechados, 12 h para metadata.
- **Limites do GA4:** avisos quando há thresholding, linha "(other)" (cardinalidade) ou amostragem.

## Estrutura

```
src/
  app/              páginas (uma pasta por seção), login, logout e /api/health
  components/       shell (filtros, navegação, exportação), gráficos, tabela, UI
  config/cro.ts     funil padrão, eventos de erro, rótulos e dimensões por seção
  lib/ga4/          cliente, cache, metadata, runReport com comparação, funil, KPIs, perfil
  lib/auth.ts       sessão assinada da tela de login
  lib/insights.ts   regras dos insights automáticos
  lib/quality.ts    diagnóstico de transaction_id
  proxy.ts          bloqueia páginas e API sem sessão
lab/ga4cro/         login OAuth e inventário (Python)
credentials/        JSONs de credencial (fora do git)
```

## Erros comuns

- **"O login do Google expirou ou foi revogado"**: rode o `login` de novo (veja a nota dos 7 dias).
- **"A Google Analytics Data API não está ativada"**: ative a API no projeto do Google Cloud.
- **"A credencial configurada não tem acesso a esta propriedade"**: o login foi feito com uma conta sem acesso, ou a Service Account não foi adicionada como Leitor.
- **"Acesso bloqueado: o app não concluiu o processo de verificação"** (na tela do Google): o e-mail não está em Usuários de teste.
- **"O GA4 não permite combinar estes campos ou filtros"**: o GA4 não cruza algumas dimensões e métricas (ex.: canal da sessão com dimensão de item). Troque o campo ou tire o filtro.

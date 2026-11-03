# Mibro Vendedores / CRM Comercial

CRM interno para a equipe comercial da Mibro: gestão de vendedores, carteira de
clientes, histórico de status/temperatura, atividades (contatos), follow-ups e
uma visão inicial (somente leitura, ainda sem integração real) de cotações e
vendas.

Este repositório contém a **Fase 1** completa e, agora, o **lado CRM da Fase
2** (token de sessão de cotação para a integração com o app Shopify
existente — ver seção
[Fase 2 — Integração CRM → Shopify (lado CRM)](#fase-2--integração-crm--shopify-lado-crm)).
O lado Shopify dessa integração e a integração com a Olist continuam **fora
deste repositório e não implementadas** — ver seção
[Pendências / Próximas fases](#pendências--próximas-fases).

## Stack

- **Next.js 15** (App Router) + **TypeScript**, mobile-first.
- **Auth.js / NextAuth v5** com Credentials Provider — sessão **JWT em cookie
  httpOnly + secure**. Nenhum dado de autenticação/autorização é guardado em
  `localStorage`/`sessionStorage`.
- **Prisma ORM** sobre **PostgreSQL**.
- **Docker + Docker Compose** (serviços `db` e `app`), Dockerfile multi-stage
  (`output: "standalone"`) para build de produção.
- **Tailwind CSS**, cor de marca `#FF6633`.
- **bcryptjs** para hash de senha.
- **Vitest** para testes unitários de helpers; um script Node simples
  (`tests/e2e-rbac.mjs`) para os testes ponta a ponta de autenticação/RBAC.
- **Leaflet** + **react-leaflet** + **react-leaflet-cluster** (tiles do
  OpenStreetMap) para o mapa comercial do admin (`/admin/mapa`) — sem chave
  de API paga.

## Como rodar localmente (Docker — recomendado)

### Ambiente "prod-like" (`docker-compose.yml`)

```bash
cp .env.example .env
# edite .env e defina SEED_ADMIN_PASSWORD, NEXTAUTH_SECRET etc.

# variáveis usadas pelo docker-compose.yml vêm do shell/.env na raiz
docker compose up -d --build

# aplicar migrations e seed (usa um serviço auxiliar com o node_modules
# completo, já que a imagem final do app é "standalone" e não inclui o CLI
# do Prisma nem o tsx)
docker compose --profile tools run --rm migrate npx prisma migrate deploy
docker compose --profile tools run --rm migrate npm run db:seed
```

A aplicação sobe em `http://localhost:3000` (ajuste a porta publicada em
`docker-compose.yml` se `3000` já estiver em uso na sua máquina — durante o
desenvolvimento deste projeto usamos `3001:3000` para não colidir com outro
projeto local). Health check simples: `GET /api/health`.

### Ambiente de desenvolvimento (`docker-compose.dev.yml`)

Sobe o Next.js em modo `next dev` (hot reload) com o código local montado
como volume:

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

> Nota: nas duas composições o Postgres é publicado por padrão em `5432`. Se
> a porta já estiver ocupada no seu host (comum quando há outros projetos
> Postgres rodando), altere o mapeamento de porta no `docker-compose*.yml`
> correspondente antes de subir — nós usamos `5434:5432` neste ambiente de
> desenvolvimento.

## Como rodar sem Docker

Requer Node 20+ e um Postgres acessível.

```bash
npm install
cp .env.example .env   # ajuste DATABASE_URL para o seu Postgres local

npx prisma generate
npx prisma migrate dev      # cria/aplica migrations em dev
npm run db:seed             # popula admin + vendedores + clientes de teste

npm run dev                 # http://localhost:3000
```

Build de produção local (sem Docker):

```bash
npm run build
npm start
```

## Credenciais de desenvolvimento

O seed (`prisma/seed.ts`) cria:

- **1 administrador**: `admin@mibro.local`, senha = valor da variável de
  ambiente `SEED_ADMIN_PASSWORD` (obrigatória — o seed **falha com erro
  claro** se ela não estiver definida; nunca há senha fixa no código).
- **1 supervisor**: `supervisor@mibro.local`, senha `vendedor123`.
- **2 vendedores**: `joao.vendedor@mibro.local` e
  `maria.vendedora@mibro.local`, senha `vendedor123`.
- Supervisor e vendedores já ganham um `SellerProfile` de exemplo (cargo,
  telefone/WhatsApp, e-mail comercial, remetente de e-mail, meta mensal,
  região). O admin de exemplo **não** ganha `SellerProfile` de propósito —
  ver [Separação `User` / `SellerProfile`](#separação-user--sellerprofile).
- ~12 clientes de exemplo distribuídos entre os dois vendedores, com status,
  temperatura, histórico e atividades de exemplo, mais uma venda confirmada.
  A maioria dos clientes também ganha uma atividade `VISITA` de exemplo com
  `LocationCapture` (`GRANTED`), para o mapa comercial do admin
  (`/admin/mapa`) já ter dados reais em desenvolvimento.

As senhas `vendedor123` são só para desenvolvimento/teste — troque-as (ou
desative os usuários) antes de qualquer uso real. Em produção, defina
`SEED_ADMIN_PASSWORD` com uma senha forte e troque a senha do admin logo após
o primeiro login.

## Estrutura de pastas

```
prisma/
  schema.prisma        # modelo de dados (fonte de verdade, não redesenhado)
  seed.ts               # seed de desenvolvimento (admin, vendedores, clientes)
  migrations/
src/
  app/
    login/               # tela de login (pública)
    (app)/                # área autenticada (layout com sidebar/bottom nav)
      dashboard/
      clientes/  clientes/novo/  clientes/[id]/
      follow-ups/
      cotacoes/
      vendas/
      perfil/
      admin/             # ADMIN-only (checado também no server component)
        vendedores/  vendedores/[id]/
        clientes/  vendas/  relatorios/  configuracoes/
        mapa/              # visão geográfica comercial (Leaflet + clustering)
    api/
      auth/[...nextauth]/
      health/
      customers/ ...     # RBAC sempre validado no backend
      followups/ ...
      quotes/  sales/
      users/ ...         # admin-only (User + SellerProfile)
      profile/           # autoedição (User.name + SellerProfile)
      admin/location-captures/  # admin-only, alimenta /admin/mapa
      customers/[id]/quote-session/       # Fase 2: gera token (sessão CRM)
      integrations/shopify/session/resolve/  # Fase 2: resolve token (segredo compartilhado)
  components/            # AppShell (sidebar/bottom nav), badges
  lib/
    prisma.ts            # client singleton
    authz.ts             # getCustomerScopeFilter — RBAC central
    audit.ts             # logAudit — ponto único de escrita em AuditLog
    duplicates.ts         # checagem de cliente duplicado
    followups.ts          # regra dos 30 dias
    config.ts             # FOLLOWUP_DEFAULT_DAYS, config da Fase 2 (TTL, URL Shopify)
    format.ts             # normalização/formatação (CNPJ, CPF, telefone, R$)
    labels.ts             # labels em pt-BR para enums do Prisma
    api-auth.ts            # requireSession/forbidden/badRequest/requireSharedSecret
    crm-session.ts          # Fase 2: gera/resolve o token de sessão de cotação
  middleware.ts           # 1ª camada de RBAC (bloqueia /admin/* no edge)
  auth.ts                 # configuração do NextAuth (Credentials, JWT)
tests/
  e2e-rbac.mjs            # testes ponta a ponta via HTTP (login, RBAC, etc.)
  e2e-quote-session.mjs   # testes ponta a ponta da Fase 2 (token de cotação)
  e2e-seller-profile-mapa.mjs  # SellerProfile na criação/edição + RBAC e dados de /admin/mapa
docs/
  SHOPIFY-INTEGRATION-ANALYSIS.md  # contexto do app Shopify (Fase 2/3)
```

## Comandos de desenvolvimento

| Comando                  | Descrição                                             |
| ------------------------- | ------------------------------------------------------ |
| `npm run dev`              | Next.js em modo desenvolvimento                        |
| `npm run build`            | Build de produção (`next build`, `output: standalone`) |
| `npm start`                | Roda o build de produção                               |
| `npm run lint`             | ESLint (flat config, `next/core-web-vitals`)            |
| `npm run test`             | Testes unitários (Vitest) — helpers de `lib/format.ts`  |
| `npm run test:e2e`         | Testes ponta a ponta via HTTP (login, RBAC, duplicidade, histórico, timeline) — precisa da app rodando em `BASE_URL` (padrão `http://localhost:3001`) |
| `npm run test:e2e:quote-session` | Testes ponta a ponta da Fase 2 (token de sessão de cotação: criação, RBAC, resolução, uso único, expiração, segredo incorreto, auditoria) — precisa da app rodando e de `CRM_SHOPIFY_SHARED_SECRET`/`DATABASE_URL` no ambiente do teste |
| `npm run test:e2e:seller-profile-mapa` | Testes ponta a ponta de `User`/`SellerProfile` (criação de vendedor já cria perfil, `/perfil` grava no perfil sem quebrar login) e do mapa comercial (`/admin/mapa` e `/api/admin/location-captures` bloqueados para não-admin, admin enxerga capturas de qualquer vendedor) — precisa da app rodando e de `DATABASE_URL` no ambiente do teste |
| `npm run prisma:generate`  | `prisma generate`                                       |
| `npm run prisma:migrate`   | `prisma migrate dev`                                    |
| `npm run prisma:deploy`    | `prisma migrate deploy` (usado em produção/Docker)      |
| `npm run db:seed`          | Roda `prisma/seed.ts`                                   |

## Decisões de arquitetura relevantes

### RBAC sempre validado no backend

Toda rota de API que lida com clientes usa `getCustomerScopeFilter(user)` em
`src/lib/authz.ts` como filtro Prisma central:

- **ADMIN**: sem restrição.
- **SUPERVISOR**: os próprios clientes + os dos vendedores cujo
  `supervisorId` aponta para ele (`User.team`).
- **VENDEDOR**: só os próprios clientes (`sellerId === user.id`).

Para acesso a um único registro (`/clientes/[id]`, atividades, status),
`canAccessCustomer(user, customer.sellerId)` reaproveita a mesma lógica. Rotas
administrativas (`/api/users*`) checam `role === "ADMIN"` explicitamente no
handler — **nunca só no frontend**. Há duas camadas independentes de bloqueio
para `/admin/*`: o `middleware.ts` (edge) e o `layout.tsx` do grupo `admin`
(server component), para que uma falha em uma camada não exponha a outra.

### Separação `User` / `SellerProfile`

`User` guarda só identidade/autenticação/RBAC: `name` (fallback mínimo de
exibição), `email`, `role`, `active`, `passwordHash`, `supervisorId`/`team`,
`createdAt`/`updatedAt`/`lastLoginAt`. Todo dado comercial (telefone,
WhatsApp, cargo, avatar, e-mail/telefone comerciais, nome e reply-to de envio
de e-mail de proposta, meta mensal, região, observações internas) fica em
`SellerProfile`, relação 1:1 opcional (`userId @unique`).

Por que separar: desativar o login de alguém (`User.active = false`) nunca
apaga o histórico comercial que outras telas ainda precisam mostrar (nome,
cargo etc. em propostas antigas); e um usuário puramente administrativo
(`role = ADMIN`) pode legitimamente não ter nenhum dado comercial — o seed
deixa o admin de exemplo sem `SellerProfile` de propósito, para validar que
nenhuma tela quebra nesse caso.

Regras de implementação seguidas em todo o código:

- **Nunca** apagar um `SellerProfile` ao desativar um `User`. Nenhuma rota
  faz isso — `PATCH /api/users/[id]` só altera `active` no `User`.
- Toda tela/rota que precisa ler dado comercial faz `include`/`select` de
  `sellerProfile` e trata `null` como caso válido (não um erro).
- Toda tela/rota que **grava** dado comercial (`PATCH /api/users/[id]`,
  `PATCH /api/profile`) usa `sellerProfile.upsert` — cria o perfil sob
  demanda na primeira edição, nunca falha porque o registro ainda não
  existe.
- Criar um vendedor/supervisor pelo admin (`POST /api/users`) cria o `User`
  e o `SellerProfile` correspondente **na mesma transação**, com pelo menos
  `displayName` preenchido — nunca fica um cadastro comercial "pela
  metade".
- Onde a UI mostra o nome do vendedor para outra pessoa (listagem de
  clientes, detalhe do cliente, painéis do admin, popup do mapa), o padrão é
  `seller.sellerProfile?.displayName ?? seller.name`: `SellerProfile.displayName`
  é o nome comercial "de verdade"; `User.name` é só o fallback mínimo.
- `Quote` grava um **snapshot** comercial do vendedor no momento da criação
  (`sellerNameSnapshot`, `sellerEmailSnapshot`, `sellerPhoneSnapshot`,
  `sellerJobTitleSnapshot`) — para que uma proposta antiga continue mostrando
  os dados de quem a criou mesmo que o `SellerProfile` mude depois (troca de
  cargo, telefone etc.). A associação real (RBAC, consultas) nunca usa esse
  snapshot, só `sellerId`.
- `/perfil` (autoedição) só edita `User.name` e campos do próprio
  `SellerProfile` (telefone, WhatsApp, cargo, avatar) — nunca `role` nem
  `active`, que continuam exclusivos de `PATCH /api/users/[id]` (admin-only).
- `AuditLog` distingue as duas entidades: mudanças em campos do `User`
  (nome, papel, supervisor) geram `USER_UPDATED`; mudanças em campos do
  `SellerProfile` (telefone, cargo, meta etc.) geram `SELLER_PROFILE_UPDATED`
  — mesmo quando vêm do mesmo clique em "Salvar" na tela de edição de
  vendedor do admin.

### Localização — `CustomerActivity` (Fase 1) e `LocationCapture` (mais rico)

Só é capturada em ação explícita: no formulário de atividade
(`src/app/(app)/clientes/[id]/activity-form.tsx`), ao escolher o tipo
"Visita", aparece o botão **"Registrar localização da visita"**, que só
aciona `navigator.geolocation.getCurrentPosition` quando clicado — nunca
automaticamente, e nunca duas vezes para a mesma ação do usuário.

Esse clique único grava dois registros, na mesma requisição
(`POST /api/customers/[id]/activities`):

1. `CustomerActivity.latitude/longitude/accuracyMeters` (Fase 1, mantido tal
   como estava, só quando o tipo é `VISITA` e a captura teve sucesso).
2. Um `LocationCapture` associado (`activityId`, único), com
   `locationSource = CUSTOMER_VISIT` e `locationStatus` mapeado do resultado
   real da Geolocation API: sucesso → `GRANTED`; permissão negada →
   `DENIED`; timeout → `TIMEOUT`; `navigator.geolocation` ausente →
   `NOT_SUPPORTED`; qualquer outro erro (`POSITION_UNAVAILABLE`) →
   `UNAVAILABLE`. **O registro é gravado mesmo quando a captura falha ou é
   negada** — "vendedor tentou e negou" é um dado diferente de "nunca
   tentou". Só `GRANTED` grava coordenadas; os demais status ficam sem
   `latitude`/`longitude`/`accuracyMeters`. `userAgentSummary` (ex.: "Chrome
   128 / Android") e `deviceType` (`mobile`/`tablet`/`desktop`) são extraídos
   no client a partir de `navigator.userAgent`/largura de tela — contexto
   leve, nunca usado para fingerprinting; **nenhum IP é coletado**.

Os valores `PROPOSAL_STARTED`/`PROPOSAL_SENT` do enum `LocationSource` estão
**preparados no schema, sem UI própria ainda** — só farão sentido quando o
fluxo da calculadora Shopify existir (fora de escopo desta fase).

### Auditoria

`src/lib/audit.ts` expõe `logAudit()` como ponto único de escrita em
`AuditLog`. É chamado em: login bem-sucedido, criação de cliente, mudança de
status/temperatura (uma entrada por campo alterado), mudança de vendedor
responsável, registro de atividade, criação de cotação (stub), confirmação e
cancelamento de venda, alterações administrativas em usuários (criação,
edição, redefinição de senha, ativação/desativação) e, desde a Fase 2, criação
e resolução do token de sessão de cotação (`QUOTE_SESSION_CREATED`,
`QUOTE_SESSION_RESOLVED` — este último com `actorId: null`, já que quem chama
é o app Shopify, não um usuário do CRM).

### Histórico de status/temperatura

`CustomerStatusHistory` nunca é sobrescrito: `POST
/api/customers/[id]/status` sempre faz um `create` (nunca `update`) para cada
campo que mudou, dentro de uma transação junto com o `update` do `Customer`.

### Follow-up automático de 30 dias

`FOLLOWUP_DEFAULT_DAYS = 30` (`src/lib/config.ts`) é usado em tempo de
consulta (não há cron job na Fase 1): um cliente aparece como "atrasado" em
`/follow-ups` (aba "Atrasados") quando `lastInteractionAt` (ou `createdAt`, se
nunca houve interação) é anterior a `now() - 30 dias`. Follow-ups manuais
(`FollowUp.source = MANUAL`) são independentes dessa regra e aparecem nas
abas "Atrasados" (se `dueAt` já passou), "Hoje" ou "Próximos" conforme a data
salva.

**Decisão sobre "Adiar"**: ao adiar um follow-up (`PATCH
/api/followups/[id]` com `action: "POSTPONE"`), o registro é **mantido com
`status = PENDENTE`** e apenas o campo `dueAt` é atualizado para a nova data.
O valor `ADIADO` do enum `FollowUpStatus` existe no schema para uso futuro
(ex.: relatórios que queiram diferenciar "nunca adiado" de "já adiado"), mas
não é usado como estado persistente na Fase 1 — a simplicidade de manter
"pendente com nova data" foi priorizada.

### Duplicidade de cliente

`src/lib/duplicates.ts` busca por CNPJ, CPF, e-mail e telefone normalizados
(`onlyDigits`/`normalizeEmail`). `POST /api/customers` responde `409` com a
lista de possíveis duplicatas quando `confirmDuplicate` não foi enviado como
`true`; o formulário de cadastro (`/clientes/novo`) mostra essa lista e exige
confirmação explícita antes de reenviar com `confirmDuplicate: true`. Nunca
bloqueia silenciosamente, nunca duplica sem aviso.

### Dinheiro e documentos

Todo valor monetário é `Int` em centavos (`*Cents`) de ponta a ponta — nunca
`float`. CNPJ/CPF/telefone são normalizados para "somente dígitos" antes de
salvar (`onlyDigits`) e formatados apenas na exibição (`formatCnpj`,
`formatCpf`, `formatPhone`, `formatCentsToBRL` em `src/lib/format.ts`).

### Localização (Geolocation API)

Ver [Localização — `CustomerActivity` (Fase 1) e `LocationCapture` (mais
rico)](#localização--customeractivity-fase-1-e-locationcapture-mais-rico)
acima.

### Cotações e vendas (Fase 1 = leitura + stub)

`/cotacoes` e `/vendas` listam `Quote`/`Sale` já escopados por RBAC. Como a
criação real de cotações virá da integração com o app Shopify existente (Fase
2/3), `/cotacoes` tem um formulário de **"criar cotação manual"** claramente
identificado no código e na UI como **stub temporário**, só para não deixar a
tela vazia durante testes desta fase. Nenhuma venda é "criada" apenas pelo
frontend dizendo que sim: a confirmação (`PATCH /api/sales/[id]` com
`action: "CONFIRM"`) valida no servidor se o estágio atual permite a
transição antes de setar `confirmedAt` e incrementar `totalSoldCents` do
cliente.

## Fase 2 — Integração CRM → Shopify (lado CRM)

Objetivo: no perfil do cliente, um botão **"Criar cotação"** gera um token de
sessão curto e de uso único, abre uma nova aba para a calculadora de atacado
do app Shopify (`SHOPIFY_WHOLESALE_URL?crm_session=<token>`) e, quando o app
Shopify (fora deste repositório) chamar o CRM de volta para resolver esse
token, devolve os dados de cliente/vendedor para pré-preencher a calculadora.

**Esta Fase 2 implementa só o lado CRM.** O lado que roda dentro do app
Shopify (`C:\ShopifyApps`, projeto separado) é responsabilidade de outro
time/repositório e **não foi tocado nem implementado aqui** — o contrato
abaixo é a especificação para essa implementação futura.

### Modelo de dados

`CrmSessionToken` (`prisma/schema.prisma`): guarda `jti` (claim do JWT, único,
usado para uso único), `customerId`, `sellerId` (vendedor cujos dados vão para
a calculadora — normalmente igual a `Customer.sellerId`, mas gravado
explicitamente no momento da criação), `createdById` (quem clicou no botão —
vendedor, supervisor ou admin), `expiresAt`, `usedAt` (nulo até ser resolvido)
e `createdAt`.

### Geração e validação do token (`src/lib/crm-session.ts`)

- JWT HS256 (lib `jose`), assinado com `CRM_SHOPIFY_SHARED_SECRET`. Claims:
  `sub` = `customerId`, `sellerId`, `jti` (`crypto.randomUUID()`), `iat`,
  `exp`.
- **O token nunca carrega CNPJ, e-mail, telefone ou qualquer dado pessoal —
  só ids internos.** Exigência explícita do dono do produto: os dados
  pessoais só saem do CRM no momento em que o app Shopify resolve o token via
  segredo compartilhado.
- TTL configurável via `QUOTE_SESSION_TTL_MINUTES` (padrão 10 minutos).
- `resolveQuoteSessionToken` verifica assinatura/expiração do JWT **e**
  confere no banco que o `CrmSessionToken` existe, não expirou e não foi
  usado (defesa em profundidade — nunca confia só na expiração do JWT), e
  marca o uso de forma atômica (`updateMany` com `usedAt: null` + checagem de
  `count === 1`) para evitar corrida em uso duplicado simultâneo.

### Endpoint 1 — criar sessão de cotação (chamado pelo frontend do CRM)

```
POST /api/customers/[id]/quote-session
```

- **Auth**: sessão normal do CRM (NextAuth/cookie httpOnly) — não usa o
  segredo compartilhado.
- **RBAC**: `canAccessCustomer` (mesmo `src/lib/authz.ts` de todas as outras
  rotas de cliente) — vendedor só para os próprios clientes, supervisor só
  para a equipe, admin qualquer um. Fora do escopo → `403`/`404`.
- **Request**: sem corpo.
- **Response `200`**:
  ```json
  { "url": "https://.../pages/consulta-de-precos?crm_session=<jwt>", "expiresAt": "2026-08-28T12:50:00.000Z", "ttlMinutes": 10 }
  ```
- **Erros**: `401` sem sessão, `403`/`404` fora do escopo RBAC, `500` se
  `SHOPIFY_WHOLESALE_URL` não estiver configurado no ambiente.
- **Auditoria**: `logAudit` grava `QUOTE_SESSION_CREATED`
  (`entityType: "Customer"`, `entityId`, `metadata: { sellerId, expiresAt }`).

### Endpoint 2 — resolver sessão (será chamado pelo app Shopify, fora de escopo agora)

```
POST /api/integrations/shopify/session/resolve
```

- **Auth**: header `Authorization: Bearer <CRM_SHOPIFY_SHARED_SECRET>`,
  comparado com `crypto.timingSafeEqual` (`src/lib/api-auth.ts#requireSharedSecret`)
  — nunca sessão de usuário do CRM. Essa rota é liberada no `middleware.ts`
  (`PUBLIC_PATHS`) porque não há cookie de sessão do CRM numa chamada
  server-to-server; a autenticação real acontece dentro do handler.
- **Request body**: `{ "token": "<jwt recebido em ?crm_session=...>" }`.
- **Response `200`**:
  ```json
  {
    "success": true,
    "customer": {
      "id": "...",
      "contactName": "...",
      "legalName": "...",
      "tradeName": "...",
      "cnpj": "somente dígitos, pode ser null",
      "email": "...",
      "phone": "somente dígitos, pode ser null"
    },
    "seller": { "id": "...", "name": "..." }
  }
  ```
- **Erros** (`{ "success": false, "code": "...", "message": "..." }`):
  - `400 INVALID_BODY` — corpo sem `token`.
  - `401 UNAUTHORIZED` — segredo ausente/incorreto.
  - `401 INVALID_TOKEN` — JWT malformado/assinatura inválida.
  - `401 TOKEN_EXPIRED` — expirado (no JWT ou no registro do banco).
  - `401 TOKEN_NOT_FOUND` — `jti` não corresponde a nenhum `CrmSessionToken`.
  - `409 TOKEN_ALREADY_USED` — token já resolvido antes (uso único).
  - `404 CUSTOMER_OR_SELLER_NOT_FOUND` — cliente/vendedor não existe mais.
  - `500 SERVER_MISCONFIGURED` — `CRM_SHOPIFY_SHARED_SECRET` não configurado
    no ambiente do CRM.
- **Auditoria**: `logAudit` grava `QUOTE_SESSION_RESOLVED`
  (`entityType: "Customer"`, `entityId`, `actorId: null` — ator é um sistema
  externo, não um `User` do CRM — com a origem em
  `metadata: { sellerId, source: "shopify-app" }`).

### UI

Botão **"Criar cotação"** em `/clientes/[id]`
(`src/app/(app)/clientes/[id]/quote-session-button.tsx`), ao lado das demais
ações do cliente: chama o endpoint 1, mostra estado de carregamento, abre a
`url` retornada em nova aba (`window.open`) e exibe "Cotação aberta em nova
aba. Válida por N minutos." usando o `ttlMinutes` da resposta (nunca
hardcoded no componente).

### Variáveis de ambiente novas

Ver `.env.example`: `CRM_SHOPIFY_SHARED_SECRET` (gerar com
`openssl rand -base64 32`; nunca versionar o valor real),
`SHOPIFY_WHOLESALE_URL` (configurar por ambiente, sem valor padrão de
produção) e `QUOTE_SESSION_TTL_MINUTES` (padrão `10`).

## Mapa comercial do admin (`/admin/mapa`)

Página só para `ADMIN` (RBAC checado em duas camadas independentes, como o
resto de `/admin/*`: `middleware.ts` no edge + `AdminLayout` como server
component; a API que alimenta os dados, `GET /api/admin/location-captures`,
checa `role === "ADMIN"` de novo, no backend, independentemente da UI) com um
mapa das visitas/interações registradas em campo.

- **Mapa**: Leaflet + tiles do OpenStreetMap (`react-leaflet`), sem chave de
  API paga. Marcadores agrupados com `react-leaflet-cluster`
  (`leaflet.markercluster`) para não poluir a visão em regiões com muitos
  registros próximos. Só aparecem no mapa capturas com
  `locationStatus = GRANTED` (as únicas com coordenada real).
- **Filtros** (recalculados no backend a cada mudança, via querystring de
  `GET /api/admin/location-captures`): vendedor, período (Hoje / Últimos 7
  dias / Mês atual / Personalizado — não havia um seletor de período
  reutilizável em outra tela, então foi criado um simples aqui), busca por
  cliente, status da proposta (`Quote.status`, só relevante quando a captura
  tem `quoteId`), venda realizada (`Sale.confirmedAt` do cliente
  relacionado) e faixa de valor (`Quote.totalValueCents`).
- **Popup do marcador**: cliente (com link para `/clientes/[id]`), vendedor
  (nome comercial do `SellerProfile`, com link para `/admin/vendedores/[id]`),
  data/hora do registro, proposta associada (se houver `quoteId`) e precisão
  aproximada (`±N m`, a partir de `accuracyMeters`).
- **Métricas no topo**: visitas presenciais no período (contagem de
  `LocationCapture` com `locationSource = CUSTOMER_VISIT`, independente do
  status — uma tentativa negada ainda é "atividade registrada"), vendedores
  com atividade registrada, cidades atendidas e valor proposto/vendido por
  região (UF).
- **Decisão de modelagem**: "cidade atendida" usa `Customer.city` (texto já
  cadastrado no CRM), **não** geocodificação reversa das coordenadas — mais
  simples, sem dependência externa (paga ou não) e suficiente para a visão
  gerencial pedida. Pelo mesmo motivo, "valor proposto/vendido por região"
  agrupa por `Customer.state`; como o Prisma não agrupa por campo de relação
  (`groupBy` só cobre colunas escalares do próprio model), as linhas de
  `Quote`/`Sale` do período são buscadas com o estado do cliente incluído e
  agregadas em memória — volume de dados do CRM é pequeno o bastante para
  isso ser simples e correto, sem precisar de SQL bruto.
- **Aviso explícito na página** (abaixo do mapa): a localização mostrada é
  **onde o vendedor registrou a visita/interação pelo celular/navegador
  dele**, nunca "o endereço confirmado da loja do cliente".

## Pendências / Próximas fases

- **Lado Shopify da integração CRM → Shopify** (consumir
  `?crm_session=<token>` na calculadora de atacado e chamar
  `POST /api/integrations/shopify/session/resolve`) e a **integração com a
  Olist** — seguem fora deste repositório e **não implementadas**. Contexto
  de negócio completo em
  [`docs/SHOPIFY-INTEGRATION-ANALYSIS.md`](docs/SHOPIFY-INTEGRATION-ANALYSIS.md).
  Isso inclui: sincronização real de `Quote` (via `shopifyQuoteToken`),
  criação de `OlistOrder`/`OlistStatusHistory` e o mapeamento de status
  Olist → CRM.
- `/admin/relatorios` e `/admin/configuracoes` são stubs "em construção".
- Follow-up automático roda em tempo de consulta (não há job/cron); uma fase
  futura pode querer materializar isso (ex.: gerar `FollowUp` com `source =
  AUTOMATICO_30_DIAS` via job agendado) em vez de calcular só na leitura.
- Não há upload de arquivo para avatar (apenas URL) nem paginação nas
  listagens (limitadas a `take: 200`/`300`) — aceitável para o volume da Fase
  1, mas deve ser revisto conforme a base de clientes cresce.

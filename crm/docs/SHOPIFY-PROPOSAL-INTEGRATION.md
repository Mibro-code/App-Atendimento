# Integração CRM ↔ Shopify — Propostas (Simulação / Cotação real)

Data: 2026-08-31. Continuação de `docs/SHOPIFY-INTEGRATION-ANALYSIS.md` (Fase
1, só leitura do app Shopify) e da Fase 2 anterior (token de sessão de
cotação, sem `mode`). Este documento descreve **o que o CRM já expõe hoje** e
**exatamente o que precisa mudar no app Shopify** (`C:\ShopifyApps\clientes-login-tt`,
fora deste repositório) para fechar o fluxo CLIENTE → PROPOSTA → SHOPIFY →
CRM → OLIST com dois modos: **SIMULAÇÃO** (nunca cria pedido Olist) e **REAL**
(segue o fluxo Olist já existente).

**Nenhuma mudança foi feita no app Shopify.** Este documento é a especificação
para quem for implementar lá — não adivinhar, seguir os contratos abaixo.

---

## 0. Visão geral do fluxo

```
CRM: cliente → "Criar proposta" → escolhe Simulação ou Cotação real
  → POST /api/customers/:id/quote-session { mode }
  → CRM grava CrmSessionToken (jti, mode, customerId, sellerId, resumeQuoteId?)
  → CRM abre nova aba: https://mibrobrasil.com.br/pages/atacado?crm_session=<jwt opaco>

Shopify (calculadora de atacado):
  → GET /apps/cnpj-validator/crm/session?token=<jwt>          [NOVO — ver seção 1]
  → CRM: POST /api/integrations/shopify/session/resolve       [JÁ EXISTE]
  → recebe { mode, customer, seller, resumeQuote }
  → pré-preenche CNPJ/cliente/vendedor, trava campos editáveis pela URL
  → vendedor monta o mix, calcula preços (fluxo atual, sem mudança)
  → SE mode = "real": segue exatamente o fluxo Olist atual (calcular-olist,
    confirmar-pedido) — sem mudança de comportamento.
  → SE mode = "simulation": calcula normalmente, mas NUNCA chama
    calcular-olist/confirmar-pedido (ou chama uma variante que não persiste
    pedido no Olist — a decidir na implementação, ver seção 5).
  → em qualquer mode, ao calcular e ao enviar e-mail, chama de volta o CRM:
    POST /api/integrations/shopify/quotes/upsert                [JÁ EXISTE, estendido]
```

O CRM nunca decide sozinho se um pedido Olist deve existir — isso é decidido
no app Shopify. Mas o app Shopify **não deve decidir o `mode` a partir de um
parâmetro de URL editável** (`?proposal_mode=simulation`) — deve sempre usar o
`mode` devolvido por `/crm/session`, que veio do banco do CRM, nunca do
navegador.

---

## 1. Novo endpoint no CRM: o que `/crm/session` (App Proxy) deve consumir

O CRM **já expõe** o endpoint que o App Proxy deve chamar:

```
POST https://<crm-host>/api/integrations/shopify/session/resolve
Authorization: Bearer <CRM_SHOPIFY_SHARED_SECRET>
Content-Type: application/json

{ "token": "<jwt recebido em ?crm_session=...>" }
```

Resposta de sucesso (200):

```json
{
  "success": true,
  "mode": "simulation",
  "customer": {
    "id": "cus_123",
    "contactName": "Maria Compradora",
    "legalName": "Comercio Maria LTDA",
    "tradeName": "Loja da Maria",
    "cnpj": "12345678000199",
    "email": "maria@example.com",
    "phone": "11999998888"
  },
  "seller": {
    "id": "usr_456",
    "name": "João Vendedor"
  },
  "resumeQuote": null
}
```

Quando a sessão foi criada para reabrir uma proposta existente ou para
"Transformar em cotação real" a partir de uma simulação, `resumeQuote` vem
preenchido:

```json
{
  "resumeQuote": {
    "id": "quo_789",
    "mode": "simulation",
    "couponCode": "BLACKFRIDAY10",
    "notes": "Cliente pediu desconto extra em frete",
    "products": {
      "products": [
        { "sku": "CAM-AZ-M", "name": "Camisa Azul", "variant": "M", "quantity": 12, "unitPriceCents": 3990, "subtotalCents": 47880 }
      ],
      "totalQuantity": 12,
      "shop": "mibro-brasil.myshopify.com"
    }
  }
}
```

Erros (não confiar em 200 implícito — checar sempre `success`):

| status | `code` | quando |
|---|---|---|
| 401 | `UNAUTHORIZED` | Bearer ausente/errado (checar `Authorization` header) |
| 401 | `INVALID_TOKEN` / `TOKEN_EXPIRED` / `TOKEN_NOT_FOUND` | JWT inválido, expirado, ou não existe mais no banco do CRM |
| 409 | `TOKEN_ALREADY_USED` | token de sessão já foi resolvido antes (uso único — ver seção 6) |
| 404 | `CUSTOMER_OR_SELLER_NOT_FOUND` | cliente/vendedor foi removido entre a criação do token e a resolução |
| 400 | `INVALID_BODY` | corpo não é `{ "token": string }` |

### 1.1. Como identificar SIMULATION/REAL

**Sempre a partir do campo `mode` desta resposta** (`"simulation"` ou
`"real"`, minúsculo). Nunca a partir de `request.url.searchParams.get("proposal_mode")`
ou qualquer outro parâmetro que o navegador possa editar. O `mode` é decidido
no CRM (o vendedor clicou "Fazer simulação" ou "Criar cotação real" dentro do
perfil do cliente, autenticado pela sessão NextAuth) e gravado no banco do CRM
junto do token — o JWT em si não carrega o `mode` de propósito (só
`customerId`/`sellerId`/`jti`), então mesmo decodificando o JWT no navegador
não dá pra descobrir ou forjar o modo.

### 1.2. Nova rota a criar no app Shopify

Arquivo sugerido: `app/routes/apps.cnpj-validator.crm.session.jsx` (App Proxy,
mesmo padrão HMAC de `apps.cnpj-validator.cnpj.jsx`).

```js
// GET /apps/cnpj-validator/crm/session?token=...
export async function loader({ request }) {
  await authenticateAppProxyShop(request); // valida HMAC do App Proxy, como hoje
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return json({ ok: false, code: "MISSING_TOKEN" }, { status: 400 });

  const res = await fetch(`${process.env.CRM_API_URL}/api/integrations/shopify/session/resolve`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.CRM_SHOPIFY_SHARED_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token }),
  });
  const body = await res.json();
  if (!res.ok || !body.success) {
    return json({ ok: false, code: body.code ?? "UNKNOWN" }, { status: res.status });
  }

  return json({
    ok: true,
    mode: body.mode,
    customer: body.customer,
    seller: body.seller,
    resumeQuote: body.resumeQuote,
  });
}
```

Novas variáveis de ambiente no app Shopify: `CRM_API_URL` (ex.:
`https://crm.mibrobrasil.com.br`) e `CRM_SHOPIFY_SHARED_SECRET` (mesmo valor
configurado no CRM). Nunca expor `CRM_SHOPIFY_SHARED_SECRET` para o frontend
— só usar dentro de arquivos `*.server.js`, igual ao padrão já usado para
Olist/Google Script.

---

## 2. Como a calculadora Liquid/JS deve ler `crm_session`

Trechos que precisarão mudar na página `calculadora-atacado.liquid` (ou
equivalente em `shopify-ready/`) e no JS que a acompanha:

1. Ao carregar a página, ler `?crm_session=` da URL (como já deve fazer hoje
   para a Fase 2 anterior).
2. Chamar `GET /apps/cnpj-validator/crm/session?token=<crm_session>` a partir
   do **frontend da loja** (essa rota é pública via App Proxy, autenticada
   por HMAC, não pelo shared secret — o shared secret só é usado
   server-to-server dentro do app Shopify).
3. Se `ok: false`: mostrar mensagem de erro amigável ("Link expirado, peça
   uma nova proposta ao vendedor") e **bloquear** a calculadora — não deixar
   o usuário prosseguir sem cliente/vendedor resolvidos.
4. Se `ok: true`: pré-preencher CNPJ/cliente/vendedor **a partir da resposta**,
   nunca a partir de outro parâmetro de URL. Os campos de cliente/vendedor
   devem ficar **somente leitura** na tela (travados) — o vendedor não deve
   poder digitar outro CNPJ/trocar de vendedor manualmente nesta tela, pois
   isso já foi decidido no CRM.
5. Guardar `mode` (e `resumeQuote`, se vier) em uma variável JS de módulo
   (não em `localStorage`/cookie) para uso durante toda a sessão da página.
6. Se `resumeQuote.products` vier preenchido, tentar restaurar o mix
   iterando `resumeQuote.products.products[]` e resolvendo cada item por
   **`sku`/`shopifyVariantId` quando disponível** (não por nome — nomes de
   produto podem ter mudado). Se um SKU não for mais encontrado no catálogo,
   pular esse item e avisar o vendedor visualmente, não travar a tela.

### 2.1. Como exibir o modo na tela (visual apenas)

Mostrar um badge "Simulação" ou "Cotação real" no topo da calculadora a
partir de `mode`, só para orientar o vendedor. **Isto é só UI** — a decisão
de negócio (seção 5) deve ser tomada no backend (`*.server.js`) do app
Shopify a partir do `mode` já resolvido no passo 3 acima, nunca relida do
DOM/JS do frontend numa chamada subsequente.

---

## 3. Como devolver a proposta ao CRM

Endpoint já existente e pronto para uso, estendido nesta entrega:

```
POST https://<crm-host>/api/integrations/shopify/quotes/upsert
Authorization: Bearer <CRM_SHOPIFY_SHARED_SECRET>
Content-Type: application/json
```

Corpo (campos novos em **negrito** na descrição; o restante já existe e é
compatível com o contrato anterior — `mode` é opcional e assume `REAL` se
omitido, então chamadas antigas continuam funcionando):

```json
{
  "event": "CALCULATED",
  "mode": "simulation",
  "shop": "mibro-brasil.myshopify.com",
  "customerId": "cus_123",
  "sellerId": "usr_456",
  "quoteToken": "publicToken-da-WholesaleQuote-do-shopify",
  "sourceQuoteId": null,
  "valueCents": 478800,
  "discountCents": 5000,
  "couponCode": "BLACKFRIDAY10",
  "notes": "Cliente pediu desconto extra em frete",
  "totalQuantity": 12,
  "products": [
    {
      "sku": "CAM-AZ-M",
      "name": "Camisa Azul",
      "variant": "M",
      "quantity": 12,
      "unitPriceCents": 3990,
      "subtotalCents": 47880
    }
  ],
  "sentToEmail": null,
  "olistOrder": null
}
```

Campos:

| campo | obrigatório | descrição |
|---|---|---|
| `event` | sim | `"CALCULATED"` (a cada cálculo), `"SENT"` (proposta enviada por e-mail), `"READY_FOR_REVIEW"` (fluxo REAL: pedido enviado para aprovação Olist) |
| `mode` | não (default `"REAL"`) | **sempre enviar** `"simulation"`/`"SIMULATION"` ou `"real"`/`"REAL"` a partir do `mode` resolvido em `/crm/session` — nunca decidir de novo aqui |
| `customerId`/`sellerId` | sim | os mesmos ids recebidos em `/crm/session` |
| `quoteToken` | sim | o `publicToken` já usado hoje pela `WholesaleQuote` — chave de correlação, gerado no frontend do Shopify, nunca pelo CRM |
| `sourceQuoteId` | não | **só** ao criar a primeira `Quote` REAL result de "Transformar em cotação real": usar `resumeQuote.id` recebido em `/crm/session`. O CRM valida que essa `Quote` de origem é uma `SIMULATION` do mesmo cliente antes de aceitar. |
| `valueCents`/`discountCents`/`couponCode`/`notes` | valueCents obrigatório, resto opcional | valores comerciais calculados no Shopify (o CRM nunca recalcula) |
| `products[]` | sim | snapshot dos itens — **preencher `sku` sempre que existir**; é o que o CRM mostra depois na tela de detalhe da proposta |
| `sentToEmail` | só no evento `SENT` | e-mail para o qual a proposta foi enviada |
| `olistOrder` | só no fluxo REAL | como já existe hoje — **nunca enviar em `mode: "simulation"`** (ver seção 5) |

Resposta de sucesso:

```json
{
  "success": true,
  "quote": { "id": "quo_789", "status": "CALCULADA", "mode": "REAL" },
  "olistOrder": null,
  "ignoredOlistOrderForSimulation": false
}
```

Erros novos além dos já existentes (`CUSTOMER_NOT_FOUND`, `SELLER_MISMATCH`,
`QUOTE_IDENTITY_MISMATCH`, `OLIST_ORDER_MISMATCH`, `INVALID_BODY`):

| status | `code` | quando |
|---|---|---|
| 409 | `SOURCE_QUOTE_INVALID` | `sourceQuoteId` não existe, não é do mesmo cliente, ou não é uma `SIMULATION` |

### 3.1. Quando chamar

- **Ao calcular** (mesmo comportamento de hoje): `event: "CALCULATED"`.
- **Ao clicar "Enviar por e-mail"** (tanto em SIMULATION quanto em REAL — o
  requisito de negócio é que a simulação também pode ser enviada
  normalmente): `event: "SENT"` com `sentToEmail` preenchido, **depois** que
  o e-mail (Resend) foi efetivamente enviado com sucesso.
- **Ao confirmar pedido** (só fluxo REAL, mesmo ponto de
  `confirmar-pedido.jsx` de hoje): `event: "READY_FOR_REVIEW"`, com
  `olistOrder` preenchido como já é feito hoje.

### 3.2. Localização da proposta (opcional, `location`)

Novo campo opcional em `quotes/upsert`, adicionado nesta entrega — **não é
rastreamento contínuo**: é uma única leitura de GPS feita no navegador do
vendedor, só quando ele mesmo clica em enviar/prosseguir a proposta, nunca em
background e nunca sem a permissão nativa do navegador. Regras de negócio que
o app Shopify **deve** seguir se decidir capturar localização também na página
da calculadora (ver seção 9.1 para o mapa exato de onde plugar isso):

- Só chamar `navigator.geolocation.getCurrentPosition(...)` — **nunca**
  `watchPosition`. Uma leitura, um resultado, fim.
- Só chamar isso a partir de uma ação explícita do vendedor (ex.: clique em
  "Enviar proposta"), nunca automaticamente ao carregar a página.
- Opções fixas: `{ enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }`.
- Se o vendedor negar ou o navegador não suportar, **a proposta deve seguir
  seu fluxo normal** (calcular, enviar e-mail, confirmar pedido) — a
  localização nunca bloqueia nada disso.
- Mostrar um texto de consentimento antes de pedir a permissão (mesmo texto já
  usado no CRM, para consistência): *"Podemos registrar sua localização neste
  momento para associar o local à proposta. Isso é usado apenas para
  registrar esta visita/proposta e não há rastreamento contínuo."* com as
  opções "Permitir localização" / "Continuar sem localização".

Formato aceito (mesmo schema usado pelo CRM internamente, `locationInputSchema`
em `src/lib/location.ts`):

```json
{
  "location": {
    "status": "GRANTED",
    "latitude": -23.5505,
    "longitude": -46.6333,
    "accuracyMeters": 22,
    "capturedAt": "2026-08-31T18:42:10.000Z"
  }
}
```

Ou, quando não há coordenada (negado/indisponível/timeout/sem suporte):

```json
{ "location": { "status": "DENIED" } }
```

| campo | obrigatório | descrição |
|---|---|---|
| `status` | sim | um de `GRANTED`, `DENIED`, `UNAVAILABLE`, `TIMEOUT`, `NOT_SUPPORTED` — mapeia direto os resultados possíveis de `getCurrentPosition` |
| `latitude`/`longitude`/`accuracyMeters` | só quando `status: "GRANTED"` | vêm de `position.coords` sem nenhum arredondamento/transformação |
| `capturedAt` | não | ISO 8601; se omitido, o CRM usa o instante em que processa a requisição |

**Nunca enviar `sellerId`/`customerId` dentro do objeto `location`** — a
captura é sempre associada ao `sellerId`/`customerId` já validados no corpo
principal da requisição (mesmos campos que `quotes/upsert` já exige hoje). O
CRM ignora qualquer id que apareça dentro de `location` porque o schema nem
aceita esses campos ali.

Efeito no CRM: quando `location` vem preenchido no evento `SENT` (preferido —
ver seção 3.1), o CRM grava um `LocationCapture` vinculado à `Quote`
(`locationSource: "PROPOSAL_SENT"`), reenvios do mesmo `quoteToken`
atualizam o mesmo registro (idempotente, nunca duplica). A resposta de sucesso
passa a incluir `locationCaptured: boolean` para o app Shopify confirmar que
foi persistido — nunca tratar isso como erro se vier `false` (proposta sem
localização é um caso normal e esperado).

Alternativa **já suportada e mais simples**: capturar a localização no CRM,
antes de abrir a aba do Shopify (ao clicar "Criar proposta" no perfil do
cliente) — o CRM já faz isso hoje (`locationSource: "PROPOSAL_STARTED"`,
`POST /api/customers/:id/quote-session`) e **não depende de nenhuma mudança no
Shopify**. Se a captura no momento do envio (`PROPOSAL_SENT`, dentro da
calculadora) for adiada para uma iteração futura, a funcionalidade de
localização da proposta já funciona ponta a ponta só com o que existe hoje no
CRM.

---

## 4. Como devolver os itens da proposta (QuoteItems)

O CRM **não criou uma tabela separada de itens** — o array `products[]`
enviado em `quotes/upsert` é salvo como snapshot em `Quote.productsSummary`
(JSON) e exibido tal como veio, mesmo que o produto mude de nome/preço depois
no catálogo Shopify. Por isso:

- Sempre reenviar a **lista completa** de itens a cada `CALCULATED` (não um
  diff) — o CRM substitui o snapshot inteiro.
- Preencher `sku` sempre que existir (é a chave usada para restaurar o mix em
  "reabrir"/"transformar em real" — ver seção 6). Se o app Shopify também
  tiver `shopifyProductId`/`shopifyVariantId`, é seguro incluir campos extra
  no objeto de cada produto — o CRM apenas os armazena no JSON e os devolve
  depois em `resumeQuote.products`, mesmo sem os validar (o schema Zod atual
  aceita `sku`/`name`/`variant`/`quantity`/`unitPriceCents`/`subtotalCents`;
  campos adicionais não quebram a validação porque objetos extras não
  declarados são ignorados pelo Zod por padrão — mas não há garantia de que
  sejam persistidos se o schema for revisado no futuro; ideal seria o CRM
  adicionar `shopifyProductId`/`shopifyVariantId` ao schema explicitamente
  numa próxima iteração, hoje fora de escopo).

---

## 5. Como evitar Olist em SIMULATION

Isto é trabalho a fazer **dentro do app Shopify** (fora deste repositório).
Pontos de decisão, a partir da análise em `SHOPIFY-INTEGRATION-ANALYSIS.md`
(seção 4):

1. Em `wholesale-order.server.js` / na rota
   `apps.cnpj-validator.atacado.calcular-olist.jsx`: antes de chamar
   `createOlistContact`/`createOlistOrder`, checar o `mode` resolvido da
   sessão CRM (guardado em memória/estado da página desde o passo 2 da seção
   2). Se `mode === "simulation"`, **pular inteiramente** a criação/atualização
   de pedido no Olist — calcular e devolver os valores normalmente, sem
   `situacao: 0` nem contato Olist algum.
2. Em `apps.cnpj-validator.atacado.confirmar-pedido.jsx`: o botão
   "Confirmar pedido"/"Enviar para análise" (que hoje adiciona o marcador
   "PARA ANÁLISE" no Olist) **não deve aparecer** na tela quando
   `mode === "simulation"` — trocar por um botão "Enviar proposta por
   e-mail" apontando só para `enviar-email.jsx` + `quotes/upsert` (`event:
   "SENT"`).
3. Defesa em profundidade no CRM: mesmo que o app Shopify envie
   `olistOrder` por engano com `mode: "simulation"`, o endpoint
   `quotes/upsert` do CRM **ignora silenciosamente** esse bloco (não cria
   nem atualiza `OlistOrder`) e retorna `ignoredOlistOrderForSimulation: true`
   na resposta — monitorar esse campo em logs do app Shopify como sinal de
   bug a corrigir, nunca depender dele como a única salvaguarda.
4. O modo teste já existente (`WholesaleSettings.testModeEnabled`) é uma
   trava **diferente e complementar**: `testModeEnabled` bloqueia qualquer
   criação real de pedido (é uma trava de ambiente); `mode: "simulation"` é
   uma escolha de negócio por proposta, feita pelo vendedor no CRM. As duas
   devem continuar funcionando juntas (`AND`), uma não substitui a outra.

---

## 6. Como receber resumeQuote/items (reabrir / transformar em real)

Dois botões no CRM (perfil da proposta) geram uma nova `crm_session`:

- **"Abrir novamente na calculadora"**: `mode` = o mesmo da proposta atual,
  `resumeQuoteId` = id da própria proposta. Usado para continuar editando uma
  proposta ainda não convertida/cancelada.
- **"Transformar em cotação real"** (só aparece em `SIMULATION` não
  convertida/cancelada): `mode = "REAL"`, `resumeQuoteId` = id da simulação
  original. **Nunca sobrescreve** a simulação original — o CRM cria uma nova
  `Quote` (mode `REAL`) só quando o Shopify chamar `quotes/upsert` com
  `sourceQuoteId` preenchido; a simulação original só é marcada
  `CONVERTIDA` nesse momento (não antes, não só por abrir a calculadora).

Em ambos os casos, o app Shopify recebe `resumeQuote` na resposta de
`/crm/session` (seção 1) com o snapshot de produtos salvo. O JS da calculadora
deve:

1. Pré-carregar `resumeQuote.products.products[]` no carrinho da
   calculadora, resolvendo por `sku` (nunca por nome).
2. **Sempre recalcular preços/impostos no momento**, nunca reaproveitar
   `unitPriceCents`/`subtotalCents` do snapshot antigo como valor final — são
   só sugestão de "o que estava no carrinho", os preços podem ter mudado.
3. Se o usuário confirmar e enviar (`quotes/upsert`), incluir
   `sourceQuoteId: resumeQuote.id` **somente** quando a ação foi
   "Transformar em cotação real" (ou seja, quando a nova proposta é REAL e a
   origem era SIMULATION) — em "Abrir novamente" (mesmo mode), usar de novo o
   `quoteToken` já existente da própria proposta (para fazer `update`, não
   `create`) e **não** enviar `sourceQuoteId`.

O token JWT usado para reabrir é sempre **novo** (TTL curto,
`QUOTE_SESSION_TTL_MINUTES`, padrão 10 min) — nunca reutilizar um
`crm_session` expirado ou já resolvido; se o vendedor demorar mais que o TTL,
peça para clicar em "Abrir novamente" de novo no CRM.

---

## 7. Endpoints — resumo

| Endpoint | Lado | Autenticação | Status |
|---|---|---|---|
| `POST /api/customers/:id/quote-session` | CRM | Sessão NextAuth (RBAC por `canAccessCustomer`) | ✅ já existe, estendido com `mode`/`resumeQuoteId` |
| `POST /api/integrations/shopify/session/resolve` | CRM | Bearer `CRM_SHOPIFY_SHARED_SECRET` | ✅ já existe, resposta estendida com `mode`/`resumeQuote` |
| `POST /api/integrations/shopify/quotes/upsert` | CRM | Bearer `CRM_SHOPIFY_SHARED_SECRET` | ✅ já existe, schema estendido (`mode`, `sourceQuoteId`, `discountCents`, `couponCode`, `notes`, `sentToEmail`, evento `SENT`, campo opcional `location` — seção 3.2) |
| `POST /api/customers/:id/quote-session` (localização) | CRM | Sessão NextAuth | ✅ já existe, aceita `location` opcional — captura `PROPOSAL_STARTED` sem depender de nenhuma mudança no Shopify |
| `GET /apps/cnpj-validator/crm/session?token=...` | App Shopify (App Proxy) | HMAC App Proxy (SDK) → chama o endpoint acima server-to-server | ❌ **a criar** (seção 1.2) |
| Ajuste em `calcular-olist`/`confirmar-pedido` para checar `mode` | App Shopify | — | ❌ **a criar** (seção 5) |

---

## 8. Exemplos de request/response — resumo rápido

**1) CRM cria a sessão** (chamado pelo botão "Fazer simulação"/"Criar cotação
real" no perfil do cliente):

```
POST /api/customers/cus_123/quote-session
Cookie: <sessão NextAuth>
{ "mode": "SIMULATION" }

200 { "url": "https://mibrobrasil.com.br/pages/atacado?crm_session=eyJ...", "expiresAt": "...", "ttlMinutes": 10, "mode": "SIMULATION" }
```

**2) Shopify resolve a sessão** (seção 1) → ver payload completo acima.

**3) Shopify devolve o cálculo** (seção 3):

```
POST /api/integrations/shopify/quotes/upsert
Authorization: Bearer ***
{ "event": "CALCULATED", "mode": "simulation", "customerId": "cus_123", "sellerId": "usr_456",
  "quoteToken": "wq_abc123...", "valueCents": 478800, "products": [...] }

200 { "success": true, "quote": { "id": "quo_789", "status": "CALCULADA", "mode": "REAL" }, "olistOrder": null, "ignoredOlistOrderForSimulation": false }
```

(nota: no exemplo acima `quote.mode` no retorno reflete o valor persistido,
não necessariamente igual ao enviado se a Quote já existia com outro `mode`
gravado antes — na prática `mode` não deve mudar depois de criado; se isso
acontecer é sinal de bug a investigar, não um comportamento esperado.)

**4) Shopify confirma envio por e-mail**:

```
POST /api/integrations/shopify/quotes/upsert
{ "event": "SENT", "mode": "simulation", "customerId": "cus_123", "sellerId": "usr_456",
  "quoteToken": "wq_abc123...", "valueCents": 478800, "products": [...], "sentToEmail": "maria@example.com" }
```

**5) Vendedor clica "Transformar em cotação real" no CRM** → nova sessão com
`mode: "REAL"`, `resumeQuoteId: "quo_789"` → Shopify resolve, recebe
`resumeQuote.products` para restaurar o mix, revenda/recalcula, e ao
confirmar envia:

```
{ "event": "READY_FOR_REVIEW", "mode": "real", "sourceQuoteId": "quo_789",
  "customerId": "cus_123", "sellerId": "usr_456", "quoteToken": "wq_novo456...",
  "valueCents": 512000, "products": [...], "olistOrder": { "id": "...", "number": "..." } }
```

---

## 9. Trechos da Liquid/JS que precisam mudar (mapa, não implementação)

Nenhum destes arquivos foi alterado — mapa para quem for implementar em
`C:\ShopifyApps\clientes-login-tt`:

- `shopify.app.toml` — nenhuma mudança de App Proxy necessária (a rota nova
  já cai sob o prefixo `apps/cnpj-validator` existente).
- Novo arquivo `app/routes/apps.cnpj-validator.crm.session.jsx` (seção 1.2).
- `app/services/wholesale-order.server.js` e a rota
  `apps.cnpj-validator.atacado.calcular-olist.jsx` — checar `mode` antes de
  chamar Olist (seção 5.1).
- `apps.cnpj-validator.atacado.confirmar-pedido.jsx` — esconder/bloquear em
  `mode: simulation` (seção 5.2).
- `apps.cnpj-validator.atacado.enviar-email.jsx` — após envio OK, chamar
  `quotes/upsert` com `event: "SENT"` (seção 3.1) — hoje esse arquivo só
  envia e-mail via Resend, não notifica o CRM.
- Tema Liquid da calculadora (`calculadora-atacado.liquid` em
  `shopify-ready/`, cópia de referência neste repo) + o JS que a acompanha:
  - ler `crm_session` da URL e chamar `/apps/cnpj-validator/crm/session`
    (seção 2);
  - travar campos de cliente/vendedor como somente-leitura vindos da
    resposta;
  - exibir badge de modo (seção 2.1);
  - restaurar `resumeQuote.products` por SKU quando presente (seção 6);
  - a cada cálculo e a cada envio de e-mail, chamar `quotes/upsert` (seção 3);
  - opcionalmente, capturar `location` no momento do envio e incluí-la no
    corpo de `quotes/upsert` (seção 3.2, trecho exato na seção 9.1 abaixo) —
    **não obrigatório** para a funcionalidade de localização já funcionar
    (o CRM já cobre `PROPOSAL_STARTED` sem depender de nenhuma mudança aqui).

### 9.1. Trecho exato de JS para capturar `location` no envio (opcional)

Se decidido também capturar no momento do envio (`PROPOSAL_SENT`, ver seção
3.2 — opcional, o CRM já funciona sem isso via `PROPOSAL_STARTED`), o trecho a
inserir no JS da calculadora, no handler do botão "Enviar proposta", **antes**
de chamar `quotes/upsert`, é exatamente este (mesma lógica usada no CRM em
`src/lib/geolocation-client.ts`, para manter os dois lados consistentes):

```js
// Chamar só dentro do clique em "Enviar proposta" — nunca ao carregar a
// página, nunca em background, nunca watchPosition.
function requestLocationAttempt() {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      resolve({ status: "NOT_SUPPORTED" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          status: "GRANTED",
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          capturedAt: new Date().toISOString(),
        });
      },
      (err) => {
        resolve({ status: err.code === err.TIMEOUT ? "TIMEOUT" : "DENIED" });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  });
}

// No handler do clique (mostrar antes o texto de consentimento da seção 3.2;
// se o vendedor escolher "Continuar sem localização", pular esta chamada e
// simplesmente não incluir `location` no corpo do POST abaixo):
const location = await requestLocationAttempt();
await fetch("/apps/cnpj-validator/atacado/enviar-proposta", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ...restanteDoPayload, location }),
});
```

O endpoint interno do app Shopify que hoje chama `quotes/upsert` no evento
`SENT` deve só repassar esse `location` recebido do frontend para dentro do
corpo de `quotes/upsert` (seção 3.2) — nenhuma transformação adicional.

### 9.2. Arquivos afetados (resumo desta seção)

- Novo serviço `app/services/crm-integration.server.js` — concentrar as
  chamadas HTTP ao CRM (`/crm/session` faz proxy de
  `/api/integrations/shopify/session/resolve`; e o envio para
  `/api/integrations/shopify/quotes/upsert`), com timeout e tratamento de
  erro não bloqueante (mesmo padrão de `sheet_sync` já usado hoje para a
  planilha de leads — se o CRM estiver fora do ar, a calculadora não deve
  travar, só logar a falha de sincronização para reprocessar depois).
- `.env.example` / `.env` da VPS do app Shopify — adicionar `CRM_API_URL` e
  `CRM_SHOPIFY_SHARED_SECRET` (mesmo valor configurado no CRM).

---

## 10. O que o CRM já entrega nesta etapa (não precisa ser refeito)

- Modelo `Quote` com `mode` (`ProposalMode`: `SIMULATION`/`REAL`), `status`
  estendido (`ABERTA`, `CALCULADA`, `ENVIADA`, `ENVIADA_PARA_ANALISE`,
  `CONVERTIDA`, `CANCELADA`, `EXPIRADA`), `discountCents`, `couponCode`,
  `notes`, `sentAt`/`sentToEmail`, `convertedAt`, `sourceQuoteId`/
  `convertedQuotes` (vínculo de conversão preservando a simulação original).
- `CrmSessionToken` com `mode` e `resumeQuoteId`, nunca lidos de query
  params — decididos no servidor a partir da sessão NextAuth do vendedor.
- UI: botão "Criar proposta" no perfil do cliente com escolha
  Simulação/Cotação real; aba de propostas no perfil do cliente; página de
  detalhe da proposta (`/cotacoes/:id`) com itens, totais, timeline e ações
  "Transformar em cotação real"/"Abrir novamente na calculadora"; lista
  `/cotacoes` com filtros por tipo/status/vendedor.
- Endpoints `quote-session`, `session/resolve` e `quotes/upsert` prontos para
  o contrato acima (compatíveis com o payload já usado em produção antes
  desta mudança — `mode` é opcional/`REAL` por padrão).
- **Localização da proposta** (seção 3.2): captura opcional via
  `getCurrentPosition` (nunca `watchPosition`), sem bloquear o envio da
  proposta em nenhum status (`GRANTED`/`DENIED`/`UNAVAILABLE`/`TIMEOUT`/
  `NOT_SUPPORTED`). `sellerId`/`customerId` sempre validados no backend, nunca
  confiados isoladamente do payload de localização. Já funciona ponta a ponta
  hoje via `PROPOSAL_STARTED` (`quote-session`, sem depender do Shopify);
  `PROPOSAL_SENT` (`quotes/upsert`) fica pronto para quando o app Shopify
  adotar o trecho da seção 9.1. UI: card "Local da proposta" em
  `/cotacoes/:id`, filtros e popup em `/admin/mapa`, aba "Localizações" no
  perfil do vendedor (`/admin/vendedores/:id`), indicador discreto na
  timeline do cliente.

---

## 11. Operação multimarcas (Mibro + Sincrofit)

O cliente e sua carteira continuam únicos no CRM. Cada `Quote`,
`CrmSessionToken` e `OlistOrder`, porém, registra `brand` (`MIBRO` ou
`SINCROFIT`). Isso permite criar propostas das duas empresas para o mesmo
cliente sem sobrescrever histórico, produtos, conversões ou pedidos.

Cada implantação do app Shopify deve usar um segredo próprio:

- Mibro: `CRM_SHOPIFY_MIBRO_SHARED_SECRET` no CRM (o antigo
  `CRM_SHOPIFY_SHARED_SECRET` continua como fallback temporário).
- Sincrofit: `CRM_SHOPIFY_SINCROFIT_SHARED_SECRET` no CRM.

No app Shopify de cada empresa, a variável pode continuar se chamando
`CRM_SHOPIFY_SHARED_SECRET`, desde que seu valor seja igual ao segredo da
respectiva empresa no CRM. A empresa de uma sincronização é inferida pelo
Bearer token no backend; nunca é aceita do payload ou da URL.

Também devem ser configuradas `MIBRO_SHOPIFY_WHOLESALE_URL` e
`SINCROFIT_SHOPIFY_WHOLESALE_URL`. A conta Olist permanece configurada e
isolada em cada app Shopify. Como ids externos podem coincidir entre contas,
o CRM usa a identidade composta `(brand, olistOrderId)`.

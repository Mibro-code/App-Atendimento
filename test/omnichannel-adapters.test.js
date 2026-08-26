const test = require("node:test");
const assert = require("node:assert/strict");
const { createAdapter, getAdapterClass } = require("../src/services/channels/channel-adapter-registry");
const { send } = require("../src/services/channels/channel-message-service");
const { normalizeInboundMessage } = require("../src/services/channels/channel-event-normalizer");
const { ALL_MANAGED_CHANNELS, META_CHANNELS, NEW_CHANNELS } = require("../src/services/channels/channel-constants");

test("todo canal gerenciado tem uma classe de adapter registrada", () => {
  for (const channel of ALL_MANAGED_CHANNELS) {
    assert.ok(getAdapterClass(channel), `esperava adapter para ${channel}`);
  }
});

test("Meta continua com capabilities completas de mensageria (zero regressão)", () => {
  const adapter = createAdapter("META");
  const capabilities = adapter.capabilities();
  assert.equal(capabilities.canSendMessages, true);
  assert.equal(capabilities.canReceiveMessages, true);
  assert.equal(capabilities.canSendMedia, true);
  assert.equal(capabilities.supportsWebhook, true);
});

test("Shopee nunca inventa endpoint: testConnection sempre NOT_SUPPORTED sem lançar exceção não tratada", async () => {
  const adapter = createAdapter("SHOPEE");
  const capabilities = adapter.capabilities();
  assert.equal(capabilities.canSendMessages, false);
  const result = await adapter.testConnection();
  assert.equal(result.status, "NOT_SUPPORTED");
});

test("Reclame Aqui é tratado como caso/reclamação, sem chat automático", async () => {
  const adapter = createAdapter("RECLAME_AQUI");
  const capabilities = adapter.capabilities();
  assert.equal(capabilities.canSendMessages, false);
  assert.equal(capabilities.canReceiveMessages, false);
  const result = await adapter.testConnection();
  assert.equal(result.status, "NOT_SUPPORTED");
});

test("Amazon restringe capabilities de verdade (nunca finge suportar chat livre)", () => {
  const adapter = createAdapter("AMAZON_MARKETPLACE");
  const capabilities = adapter.capabilities();
  for (const key of Object.keys(capabilities)) assert.equal(capabilities[key], false, `esperava ${key}=false na Amazon`);
});

test("Amazon testConnection exige lwaClientId/lwaClientSecret/refreshToken antes de qualquer chamada externa", async () => {
  const adapter = createAdapter("AMAZON_MARKETPLACE", { config: {}, secrets: {} });
  await assert.rejects(() => adapter.testConnection(), (error) => {
    assert.equal(error.channelErrorCode, "INVALID_PAYLOAD");
    return true;
  });
});

test("TikTok Shop sem accessToken retorna status amigável AUTH_PENDING, nunca erro de código", async () => {
  const adapter = createAdapter("TIKTOK_SHOP", { config: { appKey: "a", shopId: "c" }, secrets: { appSecret: "b" } });
  const result = await adapter.testConnection();
  assert.equal(result.status, "AUTH_PENDING");
});

test("TikTok Shop com token mas sem escopo de customer service confirmado nunca finge estar conectado", async () => {
  const adapter = createAdapter("TIKTOK_SHOP", { config: { appKey: "a", shopId: "c" }, secrets: { appSecret: "b", accessToken: "tok" } });
  const result = await adapter.testConnection();
  assert.equal(result.status, "NOT_SUPPORTED");
});

test("Mercado Livre normaliza notificação de pergunta para o formato interno correto", () => {
  const adapter = createAdapter("MERCADO_LIVRE");
  const [normalized] = adapter.normalizeInboundEvent({
    resource: "/questions/123456", user_id: 999, topic: "questions", sent: "2026-08-25T10:00:00.000Z",
  });
  assert.equal(normalized.channel, "MERCADO_LIVRE");
  assert.equal(normalized.type, "question");
  assert.equal(normalized.senderExternalId, "999");
  assert.equal(normalized.externalConversationId, "/questions/123456");
});

test("Mercado Livre mantém webhook desativado até existir autenticação verificável", () => {
  const adapter = createAdapter("MERCADO_LIVRE");
  assert.equal(adapter.validateWebhook({ body: {} }), false);
  assert.equal(adapter.validateWebhook({ body: { resource: "/x", topic: "questions" } }), false);
  assert.equal(adapter.capabilities().supportsWebhook, false);
});

test("Google Reviews entra como REVIEW e nunca envia resposta automática (sempre manual)", async () => {
  const adapter = createAdapter("GOOGLE_REVIEWS");
  assert.equal(adapter.capabilities().supportsReviews, true);
  await assert.rejects(() => adapter.replyToReview(), (error) => {
    assert.equal(error.channelErrorCode, "NOT_SUPPORTED");
    return true;
  });
});

test("channelMessageService.send() nunca chama um adapter sem capacidade real de envio", async () => {
  await assert.rejects(() => send({ channel: "SHOPEE", to: "x", text: "y" }), (error) => {
    assert.equal(error.channelErrorCode, "NOT_SUPPORTED");
    return true;
  });
  await assert.rejects(() => send({ channel: "AMAZON_MARKETPLACE", to: "x", text: "y" }), (error) => {
    assert.equal(error.channelErrorCode, "NOT_SUPPORTED");
    return true;
  });
});

test("normalizeInboundMessage aplica formato padrão e nunca deixa type fora do vocabulário controlado", () => {
  const normalized = normalizeInboundMessage({ channel: "EMAIL", type: "nao-existe", senderExternalId: "a@b.com" });
  assert.equal(normalized.type, "unknown");
  assert.equal(normalized.direction, "RECEBIDA");
  assert.ok(normalized.occurredAt instanceof Date);
});

test("canais Meta e novos canais não se sobrepõem na lista de gerenciados", () => {
  const overlap = META_CHANNELS.filter((channel) => NEW_CHANNELS.includes(channel));
  assert.deepEqual(overlap, []);
});

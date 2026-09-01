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
  const semConfig = await adapter.testConnection();
  assert.equal(semConfig.status, "NOT_CONFIGURED");

  const adapterComConfig = createAdapter("RECLAME_AQUI", { config: { companyId: "empresa-x" } });
  const comConfig = await adapterComConfig.testConnection();
  assert.equal(comConfig.status, "NEEDS_CONTRACT");
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
  assert.equal(result.status, "NEEDS_APPROVAL");
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

test("Mercado Livre valida webhook pelo formato mínimo do payload de notificação", () => {
  const adapter = createAdapter("MERCADO_LIVRE");
  assert.equal(adapter.validateWebhook({ body: {} }), false);
  // Faltando application_id/user_id ainda não tem o formato mínimo esperado.
  assert.equal(adapter.validateWebhook({ body: { resource: "/x", topic: "questions" } }), false);
  assert.equal(adapter.validateWebhook({
    body: { resource: "/questions/123", topic: "questions", user_id: 999, application_id: 111 },
  }), true);
  assert.equal(adapter.capabilities().supportsWebhook, true);
});

test("Mercado Livre validateWebhook confere application_id contra MERCADO_LIVRE_CLIENT_ID quando configurado", () => {
  const previous = process.env.MERCADO_LIVRE_CLIENT_ID;
  process.env.MERCADO_LIVRE_CLIENT_ID = "111";
  try {
    const adapter = createAdapter("MERCADO_LIVRE");
    assert.equal(adapter.validateWebhook({
      body: { resource: "/questions/123", topic: "questions", user_id: 999, application_id: 111 },
    }), true);
    assert.equal(adapter.validateWebhook({
      body: { resource: "/questions/123", topic: "questions", user_id: 999, application_id: 222 },
    }), false);
  } finally {
    if (previous === undefined) delete process.env.MERCADO_LIVRE_CLIENT_ID;
    else process.env.MERCADO_LIVRE_CLIENT_ID = previous;
  }
});

test("Mercado Livre sendMessage exige campos obrigatórios antes de qualquer chamada HTTP", async () => {
  const adapter = createAdapter("MERCADO_LIVRE", { secrets: {} });
  await assert.rejects(() => adapter.sendMessage({ kind: "question" }), (error) => {
    assert.equal(error.channelErrorCode, "INVALID_PAYLOAD");
    return true;
  });
  await assert.rejects(() => adapter.sendMessage({ kind: "post_sale", packId: "1" }), (error) => {
    assert.equal(error.channelErrorCode, "INVALID_PAYLOAD");
    return true;
  });
});

test("Mercado Livre sendMessage rejeita kind desconhecido com INVALID_PAYLOAD", async () => {
  const adapter = createAdapter("MERCADO_LIVRE");
  await assert.rejects(() => adapter.sendMessage({ kind: "bogus" }), (error) => {
    assert.equal(error.channelErrorCode, "INVALID_PAYLOAD");
    return true;
  });
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

// A partir daqui: Instagram Direct/Comentários e Facebook Messenger/
// Comentários deixaram de compartilhar a MetaAdapter do WhatsApp (que
// declarava capabilities completas sem nenhuma chamada real por trás) e
// ganharam classes próprias — só META (WhatsApp) fica fora do master switch.

test("META é o único canal fora de NEW_CHANNELS — Instagram/Facebook (novas contas) exigem o master switch como qualquer canal novo", () => {
  assert.deepEqual(META_CHANNELS, ["META"]);
  for (const channel of ["INSTAGRAM_DIRECT", "INSTAGRAM_COMMENTS", "FACEBOOK_MESSENGER", "FACEBOOK_COMMENTS"]) {
    assert.ok(NEW_CHANNELS.includes(channel), `esperava ${channel} em NEW_CHANNELS`);
  }
});

test("Instagram Direct e Facebook Messenger declaram capabilities de mensageria real, distintas do WhatsApp", () => {
  for (const channel of ["INSTAGRAM_DIRECT", "FACEBOOK_MESSENGER"]) {
    const capabilities = createAdapter(channel).capabilities();
    assert.equal(capabilities.canSendMessages, true, channel);
    assert.equal(capabilities.canReceiveMessages, true, channel);
    assert.equal(capabilities.canMarkRead, true, channel);
    assert.equal(capabilities.supportsWebhook, true, channel);
    assert.equal(capabilities.supportsOAuth, false, channel);
    assert.equal(capabilities.supportsPublicQuestions, false, channel);
  }
});

test("Instagram Comentários e Facebook Comentários nunca fingem suportar mídia/marcar como lido (são resposta pública, não DM)", () => {
  for (const channel of ["INSTAGRAM_COMMENTS", "FACEBOOK_COMMENTS"]) {
    const capabilities = createAdapter(channel).capabilities();
    assert.equal(capabilities.canSendMessages, true, `${channel} deve poder responder`);
    assert.equal(capabilities.canSendMedia, false, channel);
    assert.equal(capabilities.canReceiveMedia, false, channel);
    assert.equal(capabilities.canMarkRead, false, channel);
    assert.equal(capabilities.supportsPublicQuestions, true, channel);
  }
});

test("Instagram/Facebook (novos) exigem config/secrets antes de qualquer chamada — nunca fingem estar conectados", async () => {
  for (const channel of ["INSTAGRAM_DIRECT", "INSTAGRAM_COMMENTS", "FACEBOOK_MESSENGER", "FACEBOOK_COMMENTS"]) {
    const adapter = createAdapter(channel, { config: {}, secrets: {} });
    await assert.rejects(() => adapter.testConnection(), (error) => {
      assert.equal(error.channelErrorCode, "AUTH_ERROR", channel);
      return true;
    });
  }
});

test("sendMessage do Messenger/Instagram Direct exige to e text antes de qualquer chamada HTTP", async () => {
  for (const channel of ["INSTAGRAM_DIRECT", "FACEBOOK_MESSENGER"]) {
    const adapter = createAdapter(channel, { config: {}, secrets: {} });
    await assert.rejects(() => adapter.sendMessage({}), (error) => {
      assert.equal(error.channelErrorCode, "INVALID_PAYLOAD", channel);
      return true;
    });
  }
});

test("sendMessage dos Comentários exige commentId e text (é resposta pública, não mensagem direta)", async () => {
  for (const channel of ["INSTAGRAM_COMMENTS", "FACEBOOK_COMMENTS"]) {
    const adapter = createAdapter(channel, { config: {}, secrets: {} });
    await assert.rejects(() => adapter.sendMessage({ text: "oi" }), (error) => {
      assert.equal(error.channelErrorCode, "INVALID_PAYLOAD", channel);
      return true;
    });
  }
});

test("Comentários nunca aceitam envio de mídia (herdam NOT_SUPPORTED da base, sem sobrescrever)", async () => {
  for (const channel of ["INSTAGRAM_COMMENTS", "FACEBOOK_COMMENTS"]) {
    const adapter = createAdapter(channel, { config: {}, secrets: {} });
    await assert.rejects(() => adapter.sendMedia({}), (error) => {
      assert.equal(error.channelErrorCode, "NOT_SUPPORTED", channel);
      return true;
    });
  }
});

test("normalizeInboundEvent do Facebook Messenger converte payload de webhook messaging para o formato interno", () => {
  const adapter = createAdapter("FACEBOOK_MESSENGER", { config: { pageId: "999" }, secrets: {} });
  const [normalized] = adapter.normalizeInboundEvent({
    object: "page",
    entry: [{ id: "999", messaging: [{
      sender: { id: "PSID123" }, recipient: { id: "999" }, timestamp: 1735689600000,
      message: { mid: "mid.123", text: "Olá, tem estoque?" },
    }] }],
  });
  assert.equal(normalized.channel, "FACEBOOK_MESSENGER");
  assert.equal(normalized.senderExternalId, "PSID123");
  assert.equal(normalized.externalMessageId, "mid.123");
  assert.equal(normalized.type, "text");
  assert.equal(normalized.text, "Olá, tem estoque?");
  assert.equal(normalized.direction, "RECEBIDA");
});

test("normalizeInboundEvent do Instagram Comentários marca type comment e vira PUBLIC_QUESTION depois no service", () => {
  const adapter = createAdapter("INSTAGRAM_COMMENTS", { config: { igUserId: "IG1" }, secrets: {} });
  const [normalized] = adapter.normalizeInboundEvent({
    object: "instagram",
    entry: [{ id: "IG1", changes: [{
      field: "comments",
      value: { id: "comment-1", text: "Vocês entregam em SP?", from: { id: "u1", username: "cliente1" }, media: { id: "media-1" }, created_time: 1735689600 },
    }] }],
  });
  assert.equal(normalized.channel, "INSTAGRAM_COMMENTS");
  assert.equal(normalized.type, "comment");
  assert.equal(normalized.externalMessageId, "comment-1");
  assert.equal(normalized.senderExternalId, "u1");
  assert.equal(normalized.text, "Vocês entregam em SP?");
});

test("matchesWebhookPayload identifica a ChannelAccount correta quando há mais de uma Página/Perfil no mesmo canal", () => {
  const pageA = createAdapter("FACEBOOK_MESSENGER", { config: { pageId: "111" }, secrets: {} });
  const pageB = createAdapter("FACEBOOK_MESSENGER", { config: { pageId: "222" }, secrets: {} });
  const payloadForPageB = { entry: [{ id: "222", messaging: [] }] };
  assert.equal(pageA.matchesWebhookPayload(payloadForPageB), false);
  assert.equal(pageB.matchesWebhookPayload(payloadForPageB), true);
});

test("validateWebhook do Instagram/Facebook exige assinatura HMAC válida (mesma verificação do WhatsApp) fora de produção sem segredo", () => {
  const adapter = createAdapter("FACEBOOK_MESSENGER", { config: { pageId: "1" }, secrets: {} });
  const originalSecret = process.env.META_APP_SECRET;
  const originalEnv = process.env.NODE_ENV;
  try {
    delete process.env.META_APP_SECRET;
    process.env.NODE_ENV = "test";
    assert.equal(adapter.validateWebhook({ get: () => null, rawBody: null }), true);
    process.env.NODE_ENV = "production";
    assert.equal(adapter.validateWebhook({ get: () => null, rawBody: null }), false);
  } finally {
    if (originalSecret === undefined) delete process.env.META_APP_SECRET; else process.env.META_APP_SECRET = originalSecret;
    process.env.NODE_ENV = originalEnv;
  }
});

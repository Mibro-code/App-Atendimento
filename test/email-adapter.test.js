const test = require("node:test");
const assert = require("node:assert/strict");
const { createAdapter } = require("../src/services/channels/channel-adapter-registry");

test("EmailAdapter.sendMessage exige destinatário (to)", async () => {
  const adapter = createAdapter("EMAIL", { config: { provider: "GMAIL" }, secrets: { accessToken: "tok" } });
  await assert.rejects(() => adapter.sendMessage({ text: "oi" }), (error) => {
    assert.equal(error.channelErrorCode, "INVALID_PAYLOAD");
    return true;
  });
});

test("EmailAdapter.sendMessage exige text ou html", async () => {
  const adapter = createAdapter("EMAIL", { config: { provider: "GMAIL" }, secrets: { accessToken: "tok" } });
  await assert.rejects(() => adapter.sendMessage({ to: "a@b.com" }), (error) => {
    assert.equal(error.channelErrorCode, "INVALID_PAYLOAD");
    return true;
  });
});

test("EmailAdapter.sendMedia exige ao menos um anexo", async () => {
  const adapter = createAdapter("EMAIL", { config: { provider: "GMAIL" }, secrets: { accessToken: "tok" } });
  await assert.rejects(() => adapter.sendMedia({ to: "a@b.com", attachments: [] }), (error) => {
    assert.equal(error.channelErrorCode, "INVALID_PAYLOAD");
    return true;
  });
});

test("EmailAdapter.sendMedia recusa anexo em resposta de thread no Microsoft 365 (NOT_SUPPORTED)", async () => {
  const adapter = createAdapter("EMAIL", { config: { provider: "MICROSOFT_365" }, secrets: { accessToken: "tok" } });
  await assert.rejects(() => adapter.sendMedia({
    to: "a@b.com",
    attachments: [{ filename: "x.pdf", mimeType: "application/pdf", buffer: Buffer.from("x") }],
    inReplyTo: "graph-msg-id",
  }), (error) => {
    assert.equal(error.channelErrorCode, "NOT_SUPPORTED");
    return true;
  });
});

test("EmailAdapter.normalizeInboundEvent reconhece payload Gmail", () => {
  const adapter = createAdapter("EMAIL", { config: { provider: "GMAIL" }, secrets: {} });
  const rawText = Buffer.from("Olá").toString("base64url");
  const [normalized] = adapter.normalizeInboundEvent({
    id: "msg1",
    threadId: "thread1",
    internalDate: "1700000000000",
    payload: {
      headers: [
        { name: "From", value: "Fulano <fulano@example.com>" },
        { name: "Subject", value: "Assunto teste" },
      ],
      mimeType: "text/plain",
      body: { data: rawText },
    },
  });
  assert.equal(normalized.channel, "EMAIL");
  assert.equal(normalized.externalMessageId, "msg1");
  assert.equal(normalized.externalConversationId, "thread1");
  assert.equal(normalized.senderExternalId, "fulano@example.com");
  assert.equal(normalized.senderName, "Fulano");
  assert.equal(normalized.direction, "RECEBIDA");
  assert.equal(normalized.type, "text");
  assert.equal(normalized.text, "Olá");
  assert.ok(normalized.occurredAt instanceof Date);
});

test("EmailAdapter.normalizeInboundEvent reconhece payload Microsoft Graph", () => {
  const adapter = createAdapter("EMAIL", { config: { provider: "MICROSOFT_365" }, secrets: {} });
  const [normalized] = adapter.normalizeInboundEvent({
    id: "msg2",
    conversationId: "conv1",
    subject: "Assunto graph",
    from: { emailAddress: { address: "ciclana@example.com", name: "Ciclana" } },
    body: { contentType: "text", content: "Olá do Graph" },
    receivedDateTime: "2026-08-25T10:00:00.000Z",
  });
  assert.equal(normalized.channel, "EMAIL");
  assert.equal(normalized.externalMessageId, "msg2");
  assert.equal(normalized.externalConversationId, "conv1");
  assert.equal(normalized.senderExternalId, "ciclana@example.com");
  assert.equal(normalized.senderName, "Ciclana");
  assert.equal(normalized.type, "text");
  assert.equal(normalized.text, "Olá do Graph");
  assert.ok(normalized.occurredAt instanceof Date);
});

test("EmailAdapter.normalizeInboundEvent lança INVALID_PAYLOAD para formato desconhecido", () => {
  const adapter = createAdapter("EMAIL", { config: { provider: "GMAIL" }, secrets: {} });
  assert.throws(() => adapter.normalizeInboundEvent({ foo: 1 }), (error) => {
    assert.equal(error.channelErrorCode, "INVALID_PAYLOAD");
    return true;
  });
});

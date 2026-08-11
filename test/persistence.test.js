require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const prisma = require("../src/database/prisma");
const { resolveImage, resolveMedia } = require("../src/services/media-storage-service");
const { closingMessage, finalizeConversation, saveIncoming, sendImage, sendText } = require("../src/services/message-service");
const inbox = require("../src/services/inbox-service");
const mediaTestDir = path.join(os.tmpdir(), `app-whats-media-test-${process.pid}`);
process.env.MEDIA_STORAGE_DIR = mediaTestDir;

test.before(async () => {
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.contact.deleteMany();
});
test.after(async () => {
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.user.deleteMany({ where: { email: "teste@mibro.local" } });
  await prisma.category.deleteMany({ where: { OR: [
    { code: { startsWith: "FINANCEIRO_TESTE" } },
    { code: { startsWith: "SUPORTE_VIP_TESTE" } },
  ] } });
  await fs.rm(mediaTestDir, { recursive: true, force: true });
  await prisma.$disconnect();
});

test("persiste contato, conversa e mensagem sem duplicar wamid", async () => {
  const event = {
    externalId: "wamid.test.incoming", contactExternalId: "5511999999999",
    phone: "5511999999999", contactName: "Cliente Teste", type: "text", text: "Preciso de suporte",
    occurredAt: new Date("2026-08-10T12:00:00Z"), rawPayload: { id: "wamid.test.incoming" },
  };
  const results = await Promise.all([saveIncoming(event), saveIncoming(event)]);
  assert.deepEqual(results.map((item) => item.duplicate).sort(), [false, true]);
  assert.equal(await prisma.contact.count(), 1);
  assert.equal(await prisma.conversation.count(), 1);
  assert.equal(await prisma.message.count(), 1);
  const conversation = await prisma.conversation.findFirst();
  assert.equal(conversation.unreadCount, 1);
  assert.equal(conversation.status, "NOVO");
});

test("registra mensagem enviada e o atendente autor", async () => {
  const user = await prisma.user.upsert({
    where: { email: "teste@mibro.local" }, update: {},
    create: { name: "Atendente Teste", email: "teste@mibro.local", role: "ATENDENTE" },
  });
  const category = await prisma.category.findUnique({ where: { code: "SUPORTE" } });
  let conversation = await prisma.conversation.findFirst();
  conversation = await inbox.updateConversation(conversation.id, { categoryId: category.id });
  assert.equal(conversation.status, "NOVO");
  let providerText;
  const channel = { sendText: async (_phone, text) => { providerText = text; return { externalId: "wamid.test.outgoing", data: { messages: [{ id: "wamid.test.outgoing" }] } }; } };
  const result = await sendText({ conversationId: conversation.id, text: "Qual é o modelo?", sentByUserId: user.id, channel });
  assert.equal(providerText, "[*Suporte*]\n\nQual é o modelo?");
  assert.equal(result.message.text, "Qual é o modelo?");
  assert.equal(result.message.direction, "ENVIADA");
  assert.equal(result.message.sentByUserId, user.id);
  assert.equal(await prisma.message.count(), 2);
  assert.equal((await prisma.conversation.findUnique({ where: { id: conversation.id } })).status, "AGUARDANDO_CLIENTE");
});

test("lista, pesquisa, classifica, lê, finaliza e reabre a conversa", async () => {
  const category = await prisma.category.findUnique({ where: { code: "SUPORTE" } });
  const user = await prisma.user.findUnique({ where: { email: "teste@mibro.local" } });
  let conversation = await prisma.conversation.findFirst();
  conversation = await inbox.updateConversation(conversation.id, {
    categoryId: category.id, assignedUserId: user.id,
  });
  assert.equal(conversation.category.code, "SUPORTE");
  assert.equal(conversation.status, "EM_ATENDIMENTO");
  assert.equal(conversation.assignedUser.id, user.id);

  const result = await inbox.listConversations({ search: "Cliente", category: "SUPORTE", status: "EM_ATENDIMENTO" });
  assert.equal(result.length, 1);
  assert.equal(result[0].messages[0].text, "Qual é o modelo?");

  await inbox.updateConversation(conversation.id, { status: "AGUARDANDO_CLIENTE" });
  await saveIncoming({
    externalId: "wamid.test.customer.reply", contactExternalId: "5511999999999",
    phone: "5511999999999", contactName: "Cliente Teste", type: "text", text: "É o modelo X1",
    occurredAt: new Date("2026-08-10T12:05:00Z"), rawPayload: { id: "wamid.test.customer.reply" },
  });
  assert.equal((await inbox.getConversation(conversation.id)).status, "EM_ATENDIMENTO");

  let readMessageId;
  const readResult = await inbox.markAsRead(conversation.id, { channel: { markAsRead: async (messageId) => { readMessageId = messageId; } } });
  assert.equal(readMessageId, "wamid.test.customer.reply");
  assert.equal(readResult.readReceiptSent, true);
  assert.equal((await inbox.getConversation(conversation.id)).unreadCount, 0);
  await inbox.updateConversation(conversation.id, { status: "FINALIZADO" });
  assert.ok((await inbox.getConversation(conversation.id)).finalizedAt);
  await inbox.updateConversation(conversation.id, { status: "NOVO" });
  assert.equal((await inbox.getConversation(conversation.id)).finalizedAt, null);
});

test("envia mensagem neutra antes de finalizar o atendimento", async () => {
  const conversation = await prisma.conversation.findFirst();
  const user = await prisma.user.findUnique({ where: { email: "teste@mibro.local" } });
  let providerText;
  const channel = { sendText: async (_phone, text) => {
    providerText = text;
    return { externalId: "wamid.test.closing", data: { messages: [{ id: "wamid.test.closing" }] } };
  } };
  const result = await finalizeConversation({ conversationId: conversation.id, sentByUserId: user.id, channel });
  assert.equal(result.message.text, closingMessage);
  assert.equal(result.message.sentByUserId, user.id);
  assert.equal(providerText, `[*Suporte*]\n\n${closingMessage}`);
  const finalized = await inbox.getConversation(conversation.id);
  assert.equal(finalized.status, "FINALIZADO");
  assert.ok(finalized.finalizedAt);
});

test("cria e edita categorias com código único e cor validada", async () => {
  const first = await inbox.createCategory({ name: "Financeiro Teste", color: "#EF5B2A" });
  const second = await inbox.createCategory({ name: "Financeiro Teste", color: "#112233" });
  assert.equal(first.code, "FINANCEIRO_TESTE");
  assert.equal(second.code, "FINANCEIRO_TESTE_2");
  assert.equal(first.color, "#ef5b2a");
  const emoji = await inbox.createCategory({ name: "🛠️ Suporte VIP Teste", color: "#2563eb", parentId: first.id });
  assert.equal(emoji.name, "🛠️ Suporte VIP Teste");
  assert.equal(emoji.code, "SUPORTE_VIP_TESTE");
  assert.equal(emoji.parentId, first.id);
  const listed = await inbox.listCategories();
  assert.equal(listed.find((category) => category.id === emoji.id).parent.name, "Financeiro Teste");
  const conversation = await prisma.conversation.findFirst();
  await inbox.updateConversation(conversation.id, { categoryId: emoji.id });
  assert.equal((await inbox.listConversations({ category: first.code })).length, 1);
  const support = await prisma.category.findUnique({ where: { code: "SUPORTE" } });
  await inbox.updateConversation(conversation.id, { categoryId: support.id });
  const updated = await inbox.updateCategory(first.id, { name: "Financeiro", active: false });
  assert.equal(updated.name, "Financeiro");
  assert.equal(updated.active, false);
  await assert.rejects(() => inbox.createCategory({ name: "Cor inválida", color: "laranja" }), /Cor da categoria inválida/);
});

test("salva notas no contato e mantém busca pelo nome", async () => {
  const conversation = await prisma.conversation.findFirst({ include: { contact: true } });
  const note = await inbox.addContactNote(conversation.contactId, { content: "Cliente prefere atendimento no período da tarde." });
  assert.equal(note.content, "Cliente prefere atendimento no período da tarde.");
  const newerNote = await inbox.addContactNote(conversation.contactId, { content: "Nota criada depois." });
  const pinned = await inbox.setContactNotePinned(conversation.contactId, note.id, { pinned: true });
  assert.equal(pinned.pinned, true);
  const detail = await inbox.getConversation(conversation.id);
  assert.equal(detail.contact.notes.length, 2);
  assert.equal(detail.contact.notes[0].id, note.id);
  assert.equal(detail.contact.notes[0].pinned, true);
  assert.equal(detail.contact.notes[1].id, newerNote.id);
  const found = await inbox.listConversations({ search: "Cliente Teste" });
  assert.equal(found.length, 1);
  assert.equal(found[0].contact.name, "Cliente Teste");
  assert.equal(found[0].contact.notes[0].content, "Cliente prefere atendimento no período da tarde.");
  assert.equal(found[0].contact._count.notes, 2);
});

test("persiste imagens recebidas e enviadas com autoria", async () => {
  const conversation = await prisma.conversation.findFirst();
  const user = await prisma.user.findUnique({ where: { email: "teste@mibro.local" } });
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("imagem-recebida")]);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("imagem-enviada")]);
  const incoming = await saveIncoming({
    externalId: "wamid.test.image.in", contactExternalId: "5511999999999", phone: "5511999999999",
    contactName: "Cliente Teste", type: "image", text: "Foto recebida", occurredAt: new Date(),
    rawPayload: { image: { id: "media.in" } }, mediaBuffer: jpeg,
    mediaMimeType: "image/jpeg", mediaFileName: "recebida.jpg",
  });
  assert.equal(incoming.message.type, "image");
  assert.deepEqual(await fs.readFile(resolveImage(incoming.message.mediaStorageKey)), jpeg);

  let providerCaption;
  const channel = { sendImage: async (_phone, data) => { providerCaption = data.caption; return { externalId: "wamid.test.image.out", mediaId: "media.out", data: { messages: [{ id: "wamid.test.image.out" }] } }; } };
  const outgoing = await sendImage({
    conversationId: conversation.id, buffer: png, mimeType: "image/png",
    fileName: "produto.png", caption: "Imagem enviada", sentByUserId: user.id, channel,
  });
  assert.equal(outgoing.message.direction, "ENVIADA");
  assert.equal(outgoing.message.sentByUserId, user.id);
  assert.equal(outgoing.message.mediaMimeType, "image/png");
  assert.equal(outgoing.message.text, "Imagem enviada");
  assert.equal(providerCaption, "[*Suporte*]\n\nImagem enviada");
  assert.deepEqual(await fs.readFile(resolveImage(outgoing.message.mediaStorageKey)), png);
});

test("persiste áudio recebido para reprodução no histórico", async () => {
  const audio = Buffer.from("OggS-audio-opus-de-teste");
  const incoming = await saveIncoming({
    externalId: "wamid.test.audio.in", contactExternalId: "5511999999999", phone: "5511999999999",
    contactName: "Cliente Teste", type: "audio", text: "[audio]", occurredAt: new Date(),
    rawPayload: { audio: { id: "media.audio", voice: true } }, mediaBuffer: audio,
    mediaMimeType: "audio/ogg; codecs=opus", mediaFileName: "audio-media.ogg",
  });
  assert.equal(incoming.message.type, "audio");
  assert.equal(incoming.message.mediaMimeType, "audio/ogg");
  assert.equal(incoming.message.mediaFileName, "audio-media.ogg");
  assert.deepEqual(await fs.readFile(resolveMedia(incoming.message.mediaStorageKey)), audio);
});

test("persiste vídeo recebido para reprodução no histórico", async () => {
  const video = Buffer.from("0000ftyp-video-mp4-de-teste");
  const incoming = await saveIncoming({
    externalId: "wamid.test.video.in", contactExternalId: "5511999999999", phone: "5511999999999",
    contactName: "Cliente Teste", type: "video", text: "Vídeo recebido", occurredAt: new Date(),
    rawPayload: { video: { id: "media.video" } }, mediaBuffer: video,
    mediaMimeType: "video/mp4", mediaFileName: "produto.mp4",
  });
  assert.equal(incoming.message.type, "video");
  assert.equal(incoming.message.mediaMimeType, "video/mp4");
  assert.equal(incoming.message.mediaFileName, "produto.mp4");
  assert.deepEqual(await fs.readFile(resolveMedia(incoming.message.mediaStorageKey)), video);
});

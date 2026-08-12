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
const masterViewer = { id: "master-test", role: "ADMIN" };

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
    { code: { startsWith: "SUPORTE_FILHO_RESPONSAVEL_TESTE" } },
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
    where: { email: "teste@mibro.local" }, update: { role: "ADMIN" },
    create: { name: "Atendente Teste", email: "teste@mibro.local", role: "ADMIN" },
  });
  masterViewer.id = user.id;
  const category = await prisma.category.findUnique({ where: { code: "SUPORTE" } });
  let conversation = await prisma.conversation.findFirst();
  conversation = await inbox.updateConversation(conversation.id, { categoryId: category.id }, masterViewer);
  assert.equal(conversation.status, "NOVO");
  let providerText;
  const channel = { sendText: async (_phone, text) => { providerText = text; return { externalId: "wamid.test.outgoing", data: { messages: [{ id: "wamid.test.outgoing" }] } }; } };
  const result = await sendText({ conversationId: conversation.id, text: "Qual é o modelo?", sentByUserId: user.id, channel });
  assert.equal(providerText, "[*Suporte*]\n\nQual é o modelo?");
  assert.equal(result.message.text, "Qual é o modelo?");
  assert.equal(result.message.direction, "ENVIADA");
  assert.equal(result.message.sentByUserId, user.id);
  assert.equal(await prisma.message.count(), 2);
  const updatedConversation = await prisma.conversation.findUnique({ where: { id: conversation.id } });
  assert.equal(updatedConversation.status, "EM_ATENDIMENTO");
  assert.equal(updatedConversation.assignedUserId, user.id);
  assert.equal(await prisma.conversationActivity.count({
    where: { conversationId: conversation.id, action: "CONVERSATION_CLAIMED", actorUserId: user.id },
  }), 1);
});

test("lista, pesquisa, classifica, lê, finaliza e reabre a conversa", async () => {
  const category = await prisma.category.findUnique({ where: { code: "SUPORTE" } });
  const user = await prisma.user.findUnique({ where: { email: "teste@mibro.local" } });
  let conversation = await prisma.conversation.findFirst();
  conversation = await inbox.updateConversation(conversation.id, {
    categoryId: category.id, assignedUserId: user.id,
  }, masterViewer);
  assert.equal(conversation.category.code, "SUPORTE");
  assert.equal(conversation.status, "EM_ATENDIMENTO");
  assert.equal(conversation.assignedUser.id, user.id);

  const result = await inbox.listConversations({ search: "Cliente", category: "SUPORTE", status: "EM_ATENDIMENTO" }, masterViewer);
  assert.equal(result.length, 1);
  assert.equal(result[0].messages[0].text, "Qual é o modelo?");

  await saveIncoming({
    externalId: "wamid.test.customer.reply", contactExternalId: "5511999999999",
    phone: "5511999999999", contactName: "Cliente Teste", type: "text", text: "É o modelo X1",
    occurredAt: new Date("2026-08-10T12:05:00Z"), rawPayload: { id: "wamid.test.customer.reply" },
  });
  assert.equal((await inbox.getConversation(conversation.id, masterViewer)).status, "AGUARDANDO_RESPOSTA");

  let readMessageId;
  const readResult = await inbox.markAsRead(conversation.id, { channel: { markAsRead: async (messageId) => { readMessageId = messageId; } } });
  assert.equal(readMessageId, "wamid.test.customer.reply");
  assert.equal(readResult.readReceiptSent, true);
  assert.equal((await inbox.getConversation(conversation.id, masterViewer)).unreadCount, 0);
  await inbox.updateConversation(conversation.id, { status: "FINALIZADO" }, masterViewer);
  assert.ok((await inbox.getConversation(conversation.id, masterViewer)).finalizedAt);
  await inbox.updateConversation(conversation.id, { status: "NOVO" }, masterViewer);
  assert.equal((await inbox.getConversation(conversation.id, masterViewer)).finalizedAt, null);
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
  const finalized = await inbox.getConversation(conversation.id, masterViewer);
  assert.equal(finalized.status, "FINALIZADO");
  assert.ok(finalized.finalizedAt);
});

test("cria e edita categorias com código único e cor validada", async () => {
  const first = await inbox.createCategory({ name: "Financeiro Teste", color: "#EF5B2A" }, masterViewer);
  const second = await inbox.createCategory({ name: "Financeiro Teste", color: "#112233" }, masterViewer);
  assert.equal(first.code, "FINANCEIRO_TESTE");
  assert.equal(second.code, "FINANCEIRO_TESTE_2");
  assert.equal(first.color, "#ef5b2a");
  const emoji = await inbox.createCategory({ name: "🛠️ Suporte VIP Teste", color: "#2563eb", parentId: first.id }, masterViewer);
  assert.equal(emoji.name, "🛠️ Suporte VIP Teste");
  assert.equal(emoji.code, "SUPORTE_VIP_TESTE");
  assert.equal(emoji.parentId, first.id);
  const listed = await inbox.listCategories(masterViewer);
  assert.equal(listed.find((category) => category.id === emoji.id).parent.name, "Financeiro Teste");
  const conversation = await prisma.conversation.findFirst();
  await inbox.updateConversation(conversation.id, { categoryId: emoji.id }, masterViewer);
  assert.equal((await inbox.listConversations({ category: first.code }, masterViewer)).length, 1);
  const support = await prisma.category.findUnique({ where: { code: "SUPORTE" } });
  await inbox.updateConversation(conversation.id, { categoryId: support.id }, masterViewer);
  const updated = await inbox.updateCategory(first.id, { name: "Financeiro", active: false }, masterViewer);
  assert.equal(updated.name, "Financeiro");
  assert.equal(updated.active, false);
  await assert.rejects(() => inbox.createCategory({ name: "Cor inválida", color: "laranja" }, masterViewer), /Cor da categoria inválida/);
});

test("salva notas no contato e mantém busca pelo nome", async () => {
  const conversation = await prisma.conversation.findFirst({ include: { contact: true } });
  const note = await inbox.addContactNote(conversation.contactId, { content: "Cliente prefere atendimento no período da tarde." }, masterViewer);
  assert.equal(note.content, "Cliente prefere atendimento no período da tarde.");
  const newerNote = await inbox.addContactNote(conversation.contactId, { content: "Nota criada depois." }, masterViewer);
  const pinned = await inbox.setContactNotePinned(conversation.contactId, note.id, { pinned: true }, masterViewer);
  assert.equal(pinned.pinned, true);
  const detail = await inbox.getConversation(conversation.id, masterViewer);
  assert.equal(detail.contact.notes.length, 2);
  assert.equal(detail.contact.notes[0].id, note.id);
  assert.equal(detail.contact.notes[0].pinned, true);
  assert.equal(detail.contact.notes[1].id, newerNote.id);
  const found = await inbox.listConversations({ search: "Cliente Teste" }, masterViewer);
  assert.equal(found.length, 1);
  assert.equal(found[0].contact.name, "Cliente Teste");
  assert.equal(found[0].contact.notes[0].content, "Cliente prefere atendimento no período da tarde.");
  assert.equal(found[0].contact._count.notes, 2);
});

test("fixa conversas por conta, restringe exclusão de notas e registra o histórico", async () => {
  const conversation = await prisma.conversation.findFirst({ include: { contact: true } });
  const master = await prisma.user.findUnique({ where: { email: "teste@mibro.local" } });
  const otherMaster = await prisma.user.create({
    data: { name: "Outro Master", email: "outro-master@mibro.local", role: "ADMIN" },
  });
  const attendantViewer = { id: "atendente-sem-permissao", role: "ATENDENTE" };

  await inbox.setConversationPinned(conversation.id, { pinned: true }, { id: master.id, role: "ADMIN" });
  const masterList = await inbox.listConversations({}, { id: master.id, role: "ADMIN" });
  const otherList = await inbox.listConversations({}, { id: otherMaster.id, role: "ADMIN" });
  assert.equal(masterList.find(({ id }) => id === conversation.id).isPinned, true);
  assert.equal(otherList.find(({ id }) => id === conversation.id).isPinned, false);

  const note = await inbox.addContactNote(conversation.contactId, {
    content: "Nota que será removida pelo Master.", authorId: master.id, conversationId: conversation.id,
  }, { id: master.id, role: "ADMIN" });
  await assert.rejects(
    () => inbox.deleteContactNote(conversation.contactId, note.id, { conversationId: conversation.id }, attendantViewer),
    /Somente uma conta Master/,
  );
  await inbox.deleteContactNote(conversation.contactId, note.id, { conversationId: conversation.id }, { id: master.id, role: "ADMIN" });
  assert.equal(await prisma.contactNote.count({ where: { id: note.id } }), 0);

  const detail = await inbox.getConversation(conversation.id, { id: master.id, role: "ADMIN" });
  assert.ok(detail.activities.some(({ action }) => action === "NOTE_ADDED"));
  assert.ok(detail.activities.some(({ action }) => action === "NOTE_DELETED"));
  assert.equal(detail.isPinned, true);

  const alertStart = new Date(Date.now() - 1000).toISOString();
  await inbox.updateConversation(conversation.id, { assignedUserId: otherMaster.id }, { id: master.id, role: "ADMIN" });
  const targetAlerts = await inbox.getUserAlerts({ since: alertStart }, { id: otherMaster.id, role: "ADMIN" });
  assert.ok(targetAlerts.alerts.some(({ title, conversationId }) => title === "Conversa transferida para você" && conversationId === conversation.id));

  const support = await prisma.category.findUnique({ where: { code: "SUPORTE" } });
  const handoffAgent = await prisma.user.create({
    data: {
      name: "Atendente Encaminhado", email: "encaminhado@mibro.local", role: "ATENDENTE",
      categoryAccess: { create: [{ categoryId: support.id }] },
    },
  });
  await inbox.updateConversation(conversation.id, { assignedUserId: handoffAgent.id }, { id: master.id, role: "ADMIN" });
  const afterTransferMessage = await prisma.message.create({ data: {
    conversationId: conversation.id, direction: "RECEBIDA", status: "RECEBIDA", type: "text",
    text: "Mensagem posterior ao encaminhamento", occurredAt: new Date(Date.now() + 1000),
  } });
  const limitedDetail = await inbox.getConversation(conversation.id, {
    id: handoffAgent.id, role: "ATENDENTE", canViewPreviousMessages: false,
  });
  assert.equal(limitedDetail.messageHistoryLimited, true);
  assert.deepEqual(limitedDetail.messages.map(({ id }) => id), [afterTransferMessage.id]);
  const fullDetail = await inbox.getConversation(conversation.id, {
    id: handoffAgent.id, role: "ATENDENTE", canViewPreviousMessages: true,
  });
  assert.equal(fullDetail.messageHistoryLimited, false);
  assert.ok(fullDetail.messages.length > limitedDetail.messages.length);

  await inbox.updateConversation(conversation.id, { status: "FINALIZADO" }, { id: master.id, role: "ADMIN" });
  const activeAssignments = await inbox.listConversations({ assignedUser: handoffAgent.id, activeOnly: "true" }, { id: master.id, role: "ADMIN" });
  assert.equal(activeAssignments.some(({ id }) => id === conversation.id), false);
  await inbox.updateConversation(conversation.id, { status: "NOVO", assignedUserId: master.id }, { id: master.id, role: "ADMIN" });
  const commercial = await prisma.category.findUnique({ where: { code: "COMERCIAL" } });
  const supportChild = await inbox.createCategory({
    name: "Suporte Filho Responsavel Teste", parentId: support.id,
  }, { id: master.id, role: "ADMIN" });
  const categoryActivitiesBefore = await prisma.conversationActivity.count({ where: { conversationId: conversation.id, action: "CATEGORY_CHANGED" } });
  await inbox.updateConversation(conversation.id, { categoryId: supportChild.id }, { id: master.id, role: "ADMIN" });
  assert.equal((await prisma.conversation.findUnique({ where: { id: conversation.id } })).assignedUserId, master.id);
  await inbox.updateConversation(conversation.id, { categoryId: commercial.id }, { id: master.id, role: "ADMIN" });
  assert.equal((await prisma.conversation.findUnique({ where: { id: conversation.id } })).assignedUserId, null);
  await inbox.updateConversation(conversation.id, { categoryId: support.id }, { id: master.id, role: "ADMIN" });
  const categoryActivitiesAfter = await prisma.conversationActivity.count({ where: { conversationId: conversation.id, action: "CATEGORY_CHANGED" } });
  assert.equal(categoryActivitiesAfter, categoryActivitiesBefore + 2);
  assert.ok((await inbox.getConversation(conversation.id, { id: master.id, role: "ADMIN" })).activities
    .some(({ action, details }) => action === "ASSIGNEE_REMOVED" && details.fromUserId === master.id));
  await prisma.user.delete({ where: { id: handoffAgent.id } });
  await prisma.user.delete({ where: { id: otherMaster.id } });
});

test("permite ao atendente autorizado transferir setores e oculta mensagens anteriores", async () => {
  const conversation = await prisma.conversation.findFirst();
  await prisma.message.updateMany({
    where: { conversationId: conversation.id }, data: { occurredAt: new Date(Date.now() - 1000) },
  });
  const support = await prisma.category.findUnique({ where: { code: "SUPORTE" } });
  const commercial = await prisma.category.findUnique({ where: { code: "COMERCIAL" } });
  await inbox.updateConversation(conversation.id, { categoryId: support.id, assignedUserId: null }, masterViewer);
  const transferAgent = await prisma.user.create({
    data: {
      name: "Atendente Comercial", email: "transferencia-setor@mibro.local", role: "ATENDENTE",
      canTransferConversations: true, canViewPreviousMessages: false,
      categoryAccess: { create: [{ categoryId: commercial.id }] },
    },
  });
  const viewer = {
    id: transferAgent.id, role: "ATENDENTE", canTransferConversations: true,
    canViewPreviousMessages: false,
  };

  await inbox.updateConversation(conversation.id, { categoryId: commercial.id }, masterViewer);
  const sectorLimited = await inbox.getConversation(conversation.id, viewer);
  assert.equal(sectorLimited.messageHistoryLimited, true);
  assert.equal(sectorLimited.messages.length, 0);

  await inbox.updateConversation(conversation.id, { assignedUserId: transferAgent.id }, masterViewer);
  const visibleMessage = await prisma.message.create({ data: {
    conversationId: conversation.id, direction: "RECEBIDA", status: "RECEBIDA", type: "text",
    text: "Mensagem recebida depois do encaminhamento", occurredAt: new Date(Date.now() + 1000),
  } });
  const assignedLimited = await inbox.getConversation(conversation.id, viewer);
  assert.equal(assignedLimited.messageHistoryLimited, true);
  assert.deepEqual(assignedLimited.messages.map(({ id }) => id), [visibleMessage.id]);

  const categories = await inbox.listCategories(viewer);
  assert.equal(categories.find(({ id }) => id === support.id).selectable, true);
  const moved = await inbox.updateConversation(conversation.id, { categoryId: support.id }, viewer);
  assert.equal(moved.categoryId, support.id);
  assert.equal(moved.assignedUserId, null);
  await prisma.user.delete({ where: { id: transferAgent.id } });
});

test("persiste imagens recebidas e enviadas com autoria", async () => {
  const conversation = await prisma.conversation.findFirst();
  const user = await prisma.user.findUnique({ where: { email: "teste@mibro.local" } });
  await prisma.conversation.update({ where: { id: conversation.id }, data: { assignedUserId: null } });
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
  assert.equal((await prisma.conversation.findUnique({ where: { id: conversation.id } })).assignedUserId, user.id);
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

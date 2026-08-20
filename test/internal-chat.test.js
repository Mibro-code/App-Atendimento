require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/database/prisma");
const internalChat = require("../src/services/internal-chat-service");
const inbox = require("../src/services/inbox-service");

const testEmails = [
  "chat-interno-a@mibro.test",
  "chat-interno-b@mibro.test",
];
const testContactExternalId = "internal-chat-custom-name-test";

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { email: { in: testEmails } },
    select: { id: true },
  });
  const userIds = users.map(({ id }) => id);

  if (userIds.length) {
    await prisma.internalMessage.deleteMany({
      where: { senderUserId: { in: userIds } },
    });
    await prisma.internalChat.deleteMany({
      where: {
        type: "DIRECT",
        members: { some: { userId: { in: userIds } } },
      },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  await prisma.contact.deleteMany({
    where: { externalId: testContactExternalId },
  });
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => {
  await prisma.$disconnect();
});

test("chat interno atualiza não lidas e não expõe dados do contato na sinalização", async () => {
  const [sender, recipient] = await Promise.all([
    prisma.user.create({
      data: {
        name: "Chat Interno A",
        email: testEmails[0],
        role: "ADMIN",
      },
    }),
    prisma.user.create({
      data: {
        name: "Chat Interno B",
        email: testEmails[1],
        role: "ADMIN",
      },
    }),
  ]);

  const direct = await internalChat.openDirectChat(recipient.id, sender);
  const availableUsers = await internalChat.listAvailableUsers(sender);
  assert.equal(availableUsers.some(({ id }) => id === recipient.id), true);
  assert.equal(availableUsers.some(({ id }) => id === sender.id), false);
  assert.equal(availableUsers.every((user) => Object.keys(user).length === 2), true);
  const sent = await internalChat.sendMessage(direct.id, "Olá, equipe", sender);
  assert.equal(sent.text, "Olá, equipe");

  let recipientChats = await internalChat.listChats(recipient);
  let recipientDirect = recipientChats.find(({ id }) => id === direct.id);
  assert.equal(recipientDirect.unreadCount, 1);

  await internalChat.markAsRead(direct.id, recipient);
  recipientChats = await internalChat.listChats(recipient);
  recipientDirect = recipientChats.find(({ id }) => id === direct.id);
  assert.equal(recipientDirect.unreadCount, 0);

  const category = await prisma.category.findFirst({
    where: { active: true, parentId: null },
  });
  assert.ok(category);

  await internalChat.listChats(sender);
  const contact = await prisma.contact.create({
    data: {
      externalId: testContactExternalId,
      phone: "5511999990000",
      name: "Nome Meta",
      customName: "Nome Interno",
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      contactId: contact.id,
      categoryId: category.id,
      status: "EM_ATENDIMENTO",
    },
  });

  const transfer = await internalChat.createTransferNotice({
    conversationId: conversation.id,
    fromCategoryId: null,
    toCategoryId: category.id,
    actorUserId: sender.id,
  });

  assert.ok(transfer);
  assert.equal(transfer.type, "TRANSFER");
  assert.equal(transfer.metadata.toCategory, category.name);
  assert.equal("contactPhone" in transfer.metadata, false);
  assert.equal("contactName" in transfer.metadata, false);
});

test("busca de conversas encontra o nome personalizado do contato", async () => {
  const viewer = await prisma.user.create({
    data: {
      name: "Busca Customizada",
      email: testEmails[0],
      role: "ADMIN",
    },
  });
  const contact = await prisma.contact.create({
    data: {
      externalId: testContactExternalId,
      phone: "5511999990001",
      name: "Nome recebido pela Meta",
      customName: "Cliente Prioritário",
    },
  });
  const conversation = await prisma.conversation.create({
    data: { contactId: contact.id, status: "NOVO" },
  });

  const results = await inbox.listConversations(
    { search: "prioritário" },
    viewer
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].id, conversation.id);
  assert.equal(results[0].contact.customName, "Cliente Prioritário");
});

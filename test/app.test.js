require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createApp } = require("../src/app");
const prisma = require("../src/database/prisma");
const inboxEvents = require("../src/realtime/inbox-events");

test.before(async () => {
  await prisma.contactNote.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.user.deleteMany();
});

test("mantém a verificação GET do webhook da Meta", async () => {
  const previous = process.env.VERIFY_TOKEN;
  process.env.VERIFY_TOKEN = "token-de-teste";
  const server = createApp({ channel: {} }).listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=token-de-teste&hub.challenge=12345`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "12345");
  } finally {
    server.close();
    process.env.VERIFY_TOKEN = previous;
    await prisma.$disconnect();
  }
});

test("aceita somente webhooks POST com assinatura válida quando configurada", async () => {
  const previous = process.env.META_APP_SECRET;
  process.env.META_APP_SECRET = "app-secret-exclusivo-de-teste";
  const server = createApp({ channel: { parseWebhook: () => [] } }).listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const url = `http://127.0.0.1:${server.address().port}/webhook/whatsapp`;
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    const invalid = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-hub-signature-256": "sha256=incorreta" }, body });
    assert.equal(invalid.status, 401);
    const signature = `sha256=${crypto.createHmac("sha256", process.env.META_APP_SECRET).update(body).digest("hex")}`;
    const valid = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-hub-signature-256": signature }, body });
    assert.equal(valid.status, 200);
  } finally {
    server.close();
    if (previous === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = previous;
    await prisma.$disconnect();
  }
});

test("entrega o painel e as APIs básicas da caixa de entrada", async () => {
  const server = createApp({ channel: {} }).listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const protectedPage = await fetch(base, { redirect: "manual" });
    assert.equal(protectedPage.status, 302);
    assert.equal(protectedPage.headers.get("location"), "/login.html");
    assert.equal((await fetch(`${base}/api/conversations`)).status, 401);
    const setup = await fetch(`${base}/api/auth/setup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Administrador Teste", email: "admin@teste.local", password: "senha-segura-123" }) });
    assert.equal(setup.status, 201);
    const storedUser = await prisma.user.findUnique({ where: { email: "admin@teste.local" } });
    assert.notEqual(storedUser.passwordHash, "senha-segura-123");
    const cookie = setup.headers.get("set-cookie").split(";")[0];
    const page = await fetch(base, { headers: { Cookie: cookie } });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Central de Atendimento/);
    const categories = await fetch(`${base}/api/categories`, { headers: { Cookie: cookie } });
    assert.equal(categories.status, 200);
    assert.equal((await categories.json()).length, 7);
    const users = await fetch(`${base}/api/users`, { headers: { Cookie: cookie } });
    assert.equal(users.status, 200);
    assert.equal((await users.json())[0].email, "admin@teste.local");
    const createdCategory = await fetch(`${base}/api/categories`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Categoria API Teste", color: "#ef5b2a" }) });
    assert.equal(createdCategory.status, 201);
    assert.equal((await createdCategory.json()).name, "Categoria API Teste");
    const imageForm = new FormData();
    imageForm.append("image", new Blob([Buffer.from([0xff, 0xd8, 0xff, 0x00])], { type: "image/jpeg" }), "teste.jpg");
    const missingConversationImage = await fetch(`${base}/api/conversations/inexistente/images`, { method: "POST", headers: { Cookie: cookie }, body: imageForm });
    assert.equal(missingConversationImage.status, 404);
    assert.equal((await fetch(`${base}/api/messages/inexistente/media`, { headers: { Cookie: cookie } })).status, 404);
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const conversations = await fetch(`${base}/api/conversations`, { headers: { Cookie: cookie } });
    assert.equal(conversations.status, 200);
    assert.ok(Array.isArray(await conversations.json()));

    const summary = await fetch(`${base}/api/conversations/summary`, { headers: { Cookie: cookie } });
    assert.equal(summary.status, 200);
    assert.equal(typeof (await summary.json()).total, "number");
    assert.equal((await fetch(`${base}/api/events`)).status, 401);
    const eventAbort = new AbortController();
    const eventStream = await fetch(`${base}/api/events`, { headers: { Cookie: cookie }, signal: eventAbort.signal });
    assert.equal(eventStream.status, 200);
    assert.match(eventStream.headers.get("content-type"), /text\/event-stream/);
    const eventReader = eventStream.body.getReader();
    const firstEventChunk = await eventReader.read();
    assert.match(new TextDecoder().decode(firstEventChunk.value), /connected/);
    inboxEvents.publish();
    const publishedEventChunk = await eventReader.read();
    assert.match(new TextDecoder().decode(publishedEventChunk.value), /event: inbox\.updated/);
    eventAbort.abort();
    const logout = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { Cookie: cookie } });
    assert.equal(logout.status, 204);
    assert.equal((await fetch(`${base}/api/conversations`, { headers: { Cookie: cookie } })).status, 401);
    const badLogin = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@teste.local", password: "senha-errada" }) });
    assert.equal(badLogin.status, 401);
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@teste.local", password: "senha-segura-123" }) });
    assert.equal(login.status, 200);
  } finally {
    server.close();
    await prisma.category.deleteMany({ where: { code: { startsWith: "CATEGORIA_API_TESTE" } } });
    await prisma.user.deleteMany({ where: { email: "admin@teste.local" } });
    await prisma.$disconnect();
  }
});

const LOCAL_URL = "postgresql://bot_qa:isolated-local-qa@127.0.0.1:25432/bot_release_20261005";
process.chdir("C:/App Whats/local-bots-release-preview");
process.env.DATABASE_URL = LOCAL_URL;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "isolated-release-preview-only-not-production-20261005";
const prisma = require("../src/database/prisma");
(async () => {
  const passwordHash = await require("bcryptjs").hash("teste-local-bots", 10);
  await prisma.user.upsert({ where: { email: "release-bot-qa@teste.local" }, update: { passwordHash, role: "ADMIN", active: true }, create: { email: "release-bot-qa@teste.local", name: "QA local release", passwordHash, role: "ADMIN", active: true } });
  const { createApp } = require("../src/app");
  const channel = new Proxy({}, { get: () => async () => { throw new Error("Envio real bloqueado"); } });
  createApp({ channel }).listen(3340, "127.0.0.1", () => console.log("Prévia de release somente local: 127.0.0.1:3340"));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });

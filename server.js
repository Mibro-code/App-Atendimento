require("dotenv").config();
const { validateEnvironment } = require("./src/config/validate-environment");
validateEnvironment();
const { createApp } = require("./src/app");
const prisma = require("./src/database/prisma");
const MetaCloudChannel = require("./src/channels/meta-cloud-channel");
const { startInactivityMonitor } = require("./src/services/conversation-inactivity-service");
const inboxEvents = require("./src/realtime/inbox-events");

const PORT = process.env.PORT || 3000;
const channel = new MetaCloudChannel();
const server = createApp({ channel }).listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
const stopInactivityMonitor = startInactivityMonitor({ onChange: () => inboxEvents.publish() });

async function shutdown(signal) {
  console.log(`${signal} recebido. Encerrando servidor...`);
  stopInactivityMonitor();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

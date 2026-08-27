require("dotenv").config();
const { validateEnvironment } = require("./src/config/validate-environment");
validateEnvironment();
const { createApp } = require("./src/app");
const prisma = require("./src/database/prisma");
const MetaCloudChannel = require("./src/channels/meta-cloud-channel");
const { startInactivityMonitor } = require("./src/services/conversation-inactivity-service");
const { startCampaignWorker } = require("./src/services/campaign-worker-service");
const inboxEvents = require("./src/realtime/inbox-events");

const PORT = process.env.PORT || 3000;
const channel = new MetaCloudChannel();
const server = createApp({ channel }).listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
const stopInactivityMonitor = startInactivityMonitor({ onChange: () => inboxEvents.publish() });
// Item 17: fila de envio de Campanhas — mesmo padrão de monitor em processo
// do startInactivityMonitor acima; nunca dispara nada fora deste tick, e o
// master switch (CampaignGlobalSettings.massMessagingEnabled) é reconferido
// a cada tick dentro do próprio worker.
const stopCampaignWorker = startCampaignWorker({ channel, onChange: () => inboxEvents.publish() });

async function shutdown(signal) {
  console.log(`${signal} recebido. Encerrando servidor...`);
  stopInactivityMonitor();
  stopCampaignWorker();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

require("dotenv").config();
const { validateEnvironment } = require("./src/config/validate-environment");
validateEnvironment();
const { createApp } = require("./src/app");
const prisma = require("./src/database/prisma");

const PORT = process.env.PORT || 3000;
const server = createApp().listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});

async function shutdown(signal) {
  console.log(`${signal} recebido. Encerrando servidor...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

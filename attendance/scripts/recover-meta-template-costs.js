// Dry-run por padrão. --apply insere apenas registros ausentes, sem reenvios.
require("dotenv").config();
const prisma = require("../src/database/prisma");
const { recoverConfirmedTemplates } = require("../src/services/meta-cost-service");

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply")) throw new Error("Uso: node scripts/recover-meta-template-costs.js [--apply]");
  const apply = args.includes("--apply");
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...await recoverConfirmedTemplates({ apply }) }));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());

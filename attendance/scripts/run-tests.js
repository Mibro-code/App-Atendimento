const { spawnSync } = require("node:child_process");
require("dotenv").config({ quiet: true });

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL não configurada.");
const testUrl = baseUrl.includes("schema=")
  ? baseUrl.replace(/schema=[^&]+/, "schema=app_whats_test")
  : `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}schema=app_whats_test`;
const env = { ...process.env, DATABASE_URL: testUrl, NODE_ENV: "test" };

for (const [command, args] of [
  ["node", ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate", "--accept-data-loss"]],
  ["node", ["prisma/seed.js"]],
  // Restringe explicitamente a "test/**/*.test.js": sem isso, o test runner
  // varre o cwd inteiro recursivamente e pode pegar arquivos de teste de
  // outras cópias do projeto soltas no repositório (ex.: diretórios de
  // trabalho de outra ferramenta), rodando contra um Prisma Client
  // desatualizado (schema diferente) e gerando falhas que nada têm a ver
  // com o código deste projeto.
  ["node", ["--test", "--test-concurrency=1", "test/**/*.test.js"]],
]) {
  const result = spawnSync(command, args, { cwd: process.cwd(), env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

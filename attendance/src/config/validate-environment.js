const productionRequired = [
  "DATABASE_URL",
  "SESSION_SECRET",
  "VERIFY_TOKEN",
  "WHATSAPP_TOKEN",
  "PHONE_NUMBER_ID",
  "GRAPH_VERSION",
  "META_APP_SECRET",
  "INTEGRATION_API_SECRET",
];

function validateEnvironment() {
  if (process.env.NODE_ENV !== "production") return;
  const missing = productionRequired.filter((name) => !process.env[name]?.trim());
  if (missing.length) throw new Error(`Variáveis obrigatórias ausentes: ${missing.join(", ")}`);
  if (process.env.SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET deve possuir ao menos 32 caracteres.");
  if (process.env.INTEGRATION_API_SECRET.length < 32) throw new Error("INTEGRATION_API_SECRET deve possuir ao menos 32 caracteres.");
  if (!process.env.DATABASE_URL.startsWith("postgresql://") && !process.env.DATABASE_URL.startsWith("postgres://")) {
    throw new Error("DATABASE_URL deve apontar para PostgreSQL.");
  }
}

module.exports = { productionRequired, validateEnvironment };

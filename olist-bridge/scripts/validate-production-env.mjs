const requiredVariables = [
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_URL",
  "SCOPES",
  "DATABASE_URL",
];

const missingVariables = requiredVariables.filter(
  (name) => !process.env[name]?.trim(),
);

if (missingVariables.length > 0) {
  console.error(
    `Configuracao de producao incompleta. Variaveis ausentes: ${missingVariables.join(", ")}`,
  );
  process.exit(1);
}

let appUrl;

try {
  appUrl = new URL(process.env.SHOPIFY_APP_URL);
} catch {
  console.error("SHOPIFY_APP_URL precisa ser uma URL valida.");
  process.exit(1);
}

if (appUrl.protocol !== "https:") {
  console.error("SHOPIFY_APP_URL precisa usar HTTPS em producao.");
  process.exit(1);
}

if (
  appUrl.hostname === "example.com" ||
  appUrl.hostname.endsWith(".example.com")
) {
  console.error("SHOPIFY_APP_URL ainda contem um endereco de exemplo.");
  process.exit(1);
}

if (!/^postgres(?:ql)?:\/\//i.test(process.env.DATABASE_URL)) {
  console.error("DATABASE_URL precisa apontar para um banco PostgreSQL.");
  process.exit(1);
}

if (process.env.PORT && !/^\d+$/.test(process.env.PORT)) {
  console.error("PORT precisa ser um numero inteiro.");
  process.exit(1);
}

const crmVariables = ["CRM_API_URL", "CRM_SHOPIFY_SHARED_SECRET"];
const hasAnyCrmVariable = crmVariables.some((name) =>
  process.env[name]?.trim(),
);

if (hasAnyCrmVariable) {
  const missingCrmVariables = crmVariables.filter(
    (name) => !process.env[name]?.trim(),
  );
  if (missingCrmVariables.length > 0) {
    console.error(
      `Integracao CRM configurada parcialmente. Variaveis ausentes: ${missingCrmVariables.join(", ")}`,
    );
    process.exit(1);
  }

  let crmUrl;
  try {
    crmUrl = new URL(process.env.CRM_API_URL);
  } catch {
    console.error("CRM_API_URL precisa ser uma URL valida.");
    process.exit(1);
  }
  if (crmUrl.protocol !== "https:") {
    console.error("CRM_API_URL precisa usar HTTPS.");
    process.exit(1);
  }
  if (/SUBSTITUA|EXEMPLO/i.test(process.env.CRM_SHOPIFY_SHARED_SECRET)) {
    console.error("CRM_SHOPIFY_SHARED_SECRET ainda contem um valor de exemplo.");
    process.exit(1);
  }
}

if (
  process.env.OLIST_STATUS_SYNC_INTERVAL_SECONDS &&
  !/^\d+$/.test(process.env.OLIST_STATUS_SYNC_INTERVAL_SECONDS)
) {
  console.error("OLIST_STATUS_SYNC_INTERVAL_SECONDS precisa ser um numero inteiro.");
  process.exit(1);
}

const olistVariables = [
  "OLIST_CLIENT_ID",
  "OLIST_CLIENT_SECRET",
  "OLIST_REDIRECT_URI",
  "OLIST_TOKEN_ENCRYPTION_KEY",
];

const hasAnyOlistVariable = olistVariables.some((name) =>
  process.env[name]?.trim(),
);

if (hasAnyOlistVariable) {
  const missingOlistVariables = olistVariables.filter(
    (name) => !process.env[name]?.trim(),
  );

  if (missingOlistVariables.length > 0) {
    console.error(
      `Integracao Olist configurada parcialmente. Variaveis ausentes: ${missingOlistVariables.join(", ")}`,
    );
    process.exit(1);
  }

  let olistRedirectUri;

  try {
    olistRedirectUri = new URL(process.env.OLIST_REDIRECT_URI);
  } catch {
    console.error("OLIST_REDIRECT_URI precisa ser uma URL valida.");
    process.exit(1);
  }

  if (olistRedirectUri.protocol !== "https:") {
    console.error("OLIST_REDIRECT_URI precisa usar HTTPS.");
    process.exit(1);
  }

  if (
    olistRedirectUri.origin !== appUrl.origin ||
    olistRedirectUri.pathname !== "/auth/olist/callback"
  ) {
    console.error(
      "OLIST_REDIRECT_URI precisa usar o dominio do app e o caminho /auth/olist/callback.",
    );
    process.exit(1);
  }

  const encryptionKeyValue = process.env.OLIST_TOKEN_ENCRYPTION_KEY.trim();
  const encryptionKeyEncoding = /^[0-9a-f]{64}$/i.test(encryptionKeyValue)
    ? "hex"
    : "base64";
  const encryptionKey = Buffer.from(encryptionKeyValue, encryptionKeyEncoding);

  if (encryptionKey.length !== 32) {
    console.error(
      "OLIST_TOKEN_ENCRYPTION_KEY precisa conter exatamente 32 bytes em Base64 ou hexadecimal.",
    );
    process.exit(1);
  }

  for (const name of ["OLIST_CLIENT_ID", "OLIST_CLIENT_SECRET"]) {
    if (/SUBSTITUA|EXEMPLO/i.test(process.env[name])) {
      console.error(`${name} ainda contem um valor de exemplo.`);
      process.exit(1);
    }
  }
}

console.log("Configuracao obrigatoria de producao validada.");

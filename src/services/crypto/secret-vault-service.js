// Criptografia de segredos genérica (AES-256-GCM) — usada por QUALQUER
// módulo que precise guardar uma credencial cifrada no banco (integrações
// de canal, credenciais de provider de IA, futuros). Nunca duplicar esta
// lógica por módulo: cada chamador só informa QUAL variável de ambiente
// carrega a chave mestra (ex.: "INTEGRATION_ENCRYPTION_KEY",
// "AI_SECRETS_ENCRYPTION_KEY") — o algoritmo é sempre o mesmo.
//
// Se a chave mestra não estiver configurada, a aplicação continua subindo
// normalmente — só as operações que realmente gravam/leem segredo falham
// com um erro claro.
const crypto = require("node:crypto");

const ALGORITHM = "aes-256-gcm";

function loadKey(envVarName) {
  const raw = process.env[envVarName];
  if (!raw) {
    throw Object.assign(new Error(
      `${envVarName} não configurada. Defina uma chave de 32 bytes (base64 ou hex) para salvar credenciais.`,
    ), { statusCode: 503 });
  }
  let key;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) key = Buffer.from(raw, "hex");
  else key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw Object.assign(new Error(`${envVarName} deve representar exatamente 32 bytes (base64 ou hex de 64 caracteres).`), { statusCode: 500 });
  }
  return key;
}

// Cifra um objeto JSON de segredos. Retorna os três componentes que o
// schema guarda separadamente (Bytes/Bytes/Bytes).
function encryptSecrets(secretsObject, envVarName) {
  const key = loadKey(envVarName);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(secretsObject || {}), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { encryptedSecrets: encrypted, encryptionIv: iv, encryptionAuthTag: authTag, secretKeys: Object.keys(secretsObject || {}) };
}

function decryptSecrets({ encryptedSecrets, encryptionIv, encryptionAuthTag }, envVarName) {
  if (!encryptedSecrets || !encryptionIv || !encryptionAuthTag) return {};
  const key = loadKey(envVarName);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, encryptionIv);
  decipher.setAuthTag(encryptionAuthTag);
  const decrypted = Buffer.concat([decipher.update(encryptedSecrets), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}

// Mostra só os últimos 4 caracteres — nunca o valor completo.
function maskSecret(value) {
  if (!value || typeof value !== "string") return null;
  const tail = value.slice(-4);
  return `${"•".repeat(8)}${tail}`;
}

function isEncryptionConfigured(envVarName) {
  try {
    loadKey(envVarName);
    return true;
  } catch (_error) {
    return false;
  }
}

module.exports = { decryptSecrets, encryptSecrets, isEncryptionConfigured, maskSecret };

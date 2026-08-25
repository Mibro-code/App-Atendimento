// Armazenamento seguro de segredos de integração (item 9). NUNCA salvar
// clientSecret/accessToken/refreshToken em texto puro em lugar nenhum
// (frontend, localStorage, logs, git, auditoria). Aqui: AES-256-GCM com
// chave mestra vinda de env (INTEGRATION_ENCRYPTION_KEY), nunca hardcoded.
//
// Se a chave não estiver configurada, a aplicação continua subindo
// normalmente — só as operações que realmente gravam/leem segredo falham
// com um erro claro (mesmo princípio do provider de IA opcional: preparar
// suporte sem obrigar a variável a existir para o app iniciar).
const crypto = require("node:crypto");

const ALGORITHM = "aes-256-gcm";

function loadKey() {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw) {
    throw Object.assign(new Error(
      "INTEGRATION_ENCRYPTION_KEY não configurada. Defina uma chave de 32 bytes (base64 ou hex) para salvar credenciais de integrações.",
    ), { statusCode: 503 });
  }
  let key;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) key = Buffer.from(raw, "hex");
  else key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw Object.assign(new Error("INTEGRATION_ENCRYPTION_KEY deve representar exatamente 32 bytes (base64 ou hex de 64 caracteres)."), { statusCode: 500 });
  }
  return key;
}

// Cifra um objeto JSON de segredos (ex.: { clientSecret, accessToken }).
// Retorna os três componentes que o schema guarda separadamente.
function encryptSecrets(secretsObject) {
  const key = loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(secretsObject || {}), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { encryptedSecrets: encrypted, encryptionIv: iv, encryptionAuthTag: authTag, secretKeys: Object.keys(secretsObject || {}) };
}

function decryptSecrets({ encryptedSecrets, encryptionIv, encryptionAuthTag }) {
  if (!encryptedSecrets || !encryptionIv || !encryptionAuthTag) return {};
  const key = loadKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, encryptionIv);
  decipher.setAuthTag(encryptionAuthTag);
  const decrypted = Buffer.concat([decipher.update(encryptedSecrets), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}

// Mostra só os últimos 4 caracteres — nunca o valor completo (item 7).
function maskSecret(value) {
  if (!value || typeof value !== "string") return null;
  const tail = value.slice(-4);
  return `${"•".repeat(8)}${tail}`;
}

function isEncryptionConfigured() {
  try {
    loadKey();
    return true;
  } catch (_error) {
    return false;
  }
}

module.exports = { decryptSecrets, encryptSecrets, isEncryptionConfigured, maskSecret };

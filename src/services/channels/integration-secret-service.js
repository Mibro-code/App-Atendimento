// Armazenamento seguro de segredos de integração (item 9). NUNCA salvar
// clientSecret/accessToken/refreshToken em texto puro em lugar nenhum
// (frontend, localStorage, logs, git, auditoria). AES-256-GCM com chave
// mestra vinda de env (INTEGRATION_ENCRYPTION_KEY) — a cifra em si é
// genérica e compartilhada (secret-vault-service.js) com o cofre de
// credenciais de IA (ai-credential-service.js), cada um com sua própria
// variável de chave mestra.
const vault = require("../crypto/secret-vault-service");

const ENV_VAR = "INTEGRATION_ENCRYPTION_KEY";

function encryptSecrets(secretsObject) {
  return vault.encryptSecrets(secretsObject, ENV_VAR);
}

function decryptSecrets(stored) {
  return vault.decryptSecrets(stored, ENV_VAR);
}

function isEncryptionConfigured() {
  return vault.isEncryptionConfigured(ENV_VAR);
}

module.exports = {
  decryptSecrets, encryptSecrets, isEncryptionConfigured, maskSecret: vault.maskSecret,
};

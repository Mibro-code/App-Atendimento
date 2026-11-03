const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  decryptSecrets, encryptSecrets, isEncryptionConfigured, maskSecret,
} = require("../src/services/channels/integration-secret-service");

test("sem INTEGRATION_ENCRYPTION_KEY, encryptSecrets falha com erro claro e a app não é derrubada", () => {
  const original = process.env.INTEGRATION_ENCRYPTION_KEY;
  delete process.env.INTEGRATION_ENCRYPTION_KEY;
  try {
    assert.equal(isEncryptionConfigured(), false);
    assert.throws(() => encryptSecrets({ accessToken: "abc" }), /INTEGRATION_ENCRYPTION_KEY/);
  } finally {
    if (original) process.env.INTEGRATION_ENCRYPTION_KEY = original;
  }
});

test("encrypt/decrypt faz round-trip correto com chave hex de 32 bytes", () => {
  const original = process.env.INTEGRATION_ENCRYPTION_KEY;
  process.env.INTEGRATION_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
  try {
    const secrets = { accessToken: "token-super-secreto", refreshToken: "refresh-xyz" };
    const stored = encryptSecrets(secrets);
    assert.ok(Buffer.isBuffer(stored.encryptedSecrets));
    assert.ok(Buffer.isBuffer(stored.encryptionIv));
    assert.ok(Buffer.isBuffer(stored.encryptionAuthTag));
    assert.deepEqual(stored.secretKeys.sort(), ["accessToken", "refreshToken"]);
    assert.notEqual(stored.encryptedSecrets.toString("utf8"), JSON.stringify(secrets));

    const decrypted = decryptSecrets(stored);
    assert.deepEqual(decrypted, secrets);
  } finally {
    if (original) process.env.INTEGRATION_ENCRYPTION_KEY = original;
    else delete process.env.INTEGRATION_ENCRYPTION_KEY;
  }
});

test("encrypt/decrypt também aceita chave em base64", () => {
  const original = process.env.INTEGRATION_ENCRYPTION_KEY;
  process.env.INTEGRATION_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
  try {
    const stored = encryptSecrets({ clientSecret: "abc123" });
    assert.deepEqual(decryptSecrets(stored), { clientSecret: "abc123" });
  } finally {
    if (original) process.env.INTEGRATION_ENCRYPTION_KEY = original;
    else delete process.env.INTEGRATION_ENCRYPTION_KEY;
  }
});

test("chave com tamanho errado falha claramente em vez de cifrar com chave fraca", () => {
  const original = process.env.INTEGRATION_ENCRYPTION_KEY;
  process.env.INTEGRATION_ENCRYPTION_KEY = "chave-muito-curta";
  try {
    assert.throws(() => encryptSecrets({ a: "b" }), /32 bytes/);
  } finally {
    if (original) process.env.INTEGRATION_ENCRYPTION_KEY = original;
    else delete process.env.INTEGRATION_ENCRYPTION_KEY;
  }
});

test("decryptSecrets sem dados cifrados retorna objeto vazio em vez de lançar", () => {
  assert.deepEqual(decryptSecrets({}), {});
});

test("maskSecret nunca expõe o valor inteiro, só os últimos 4 caracteres", () => {
  const masked = maskSecret("EAAGabcdEFGH1234567890secretvalue");
  assert.ok(masked.endsWith("alue"));
  assert.ok(!masked.includes("EAAGabcd"));
  assert.equal(maskSecret(null), null);
});

const crypto = require("node:crypto");
const prisma = require("../database/prisma");
const { decryptSecrets } = require("../services/channels/integration-secret-service");

function equalSecret(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || !left || !right) return false;
  const a = crypto.createHash("sha256").update(left).digest();
  const b = crypto.createHash("sha256").update(right).digest();
  return crypto.timingSafeEqual(a, b);
}

// No global-secret fallback: each dedicated URL authenticates only its account.
function createAccountWebhook({ client = prisma, decrypt = decryptSecrets } = {}) {
  async function load(req) {
    return client.channelAccount.findFirst({
      where: { id: req.params.accountId, channel: "META", enabled: true, company: { is: { active: true } } },
      select: { id: true, status: true, config: true, externalAccountId: true, encryptedSecrets: true, encryptionIv: true, encryptionAuthTag: true, secretKeys: true },
    });
  }
  async function credentials(req, res) {
    const account = await load(req);
    if (!account) { res.sendStatus(404); return null; }
    let secrets;
    try { secrets = decrypt(account); }
    catch (_) { res.status(503).json({ error: "Credenciais do webhook indisponíveis." }); return null; }
    if (!secrets.appSecret || !secrets.webhookVerifyToken || !account.config?.wabaId || !account.config?.phoneNumberId) {
      res.status(503).json({ error: "Configure WABA ID, Phone Number ID, App Secret e token de verificação desta conta." });
      return null;
    }
    return { account, secrets };
  }
  return {
    async verify(req, res, next) {
      res.set("Cache-Control", "no-store");
      try {
        const value = await credentials(req, res);
        if (!value) return;
        if (req.query["hub.mode"] !== "subscribe" || typeof req.query["hub.challenge"] !== "string"
          || !equalSecret(req.query["hub.verify_token"], value.secrets.webhookVerifyToken)) return res.sendStatus(403);
        return res.status(200).type("text/plain").send(req.query["hub.challenge"]);
      } catch (error) { return next(error); }
    },
    async authenticate(req, res, next) {
      try {
        const value = await credentials(req, res);
        if (!value) return;
        const { account, secrets } = value;
        if (account.status !== "CONNECTED") return res.sendStatus(503);
        const signature = req.get("x-hub-signature-256");
        if (!Buffer.isBuffer(req.rawBody) || typeof signature !== "string" || !/^sha256=[a-f0-9]{64}$/.test(signature)) return res.sendStatus(401);
        const expected = "sha256=" + crypto.createHmac("sha256", secrets.appSecret).update(req.rawBody).digest("hex");
        if (!equalSecret(signature, expected)) return res.sendStatus(401);
        // Validate the entire batch BEFORE any event is persisted or dispatched.
        const entries = req.body?.entry;
        if (req.body?.object !== "whatsapp_business_account" || !Array.isArray(entries) || !entries.length) return res.sendStatus(400);
        for (const entry of entries) {
          if (String(entry.id) !== String(account.config.wabaId) || !Array.isArray(entry.changes) || !entry.changes.length) return res.sendStatus(403);
          for (const change of entry.changes) {
            if (String(change.value?.metadata?.phone_number_id || "") !== String(account.config.phoneNumberId)) return res.sendStatus(403);
          }
        }
        req.metaWebhookAccount = account;
        return next();
      } catch (error) { return next(error); }
    },
  };
}

module.exports = { createAccountWebhook, equalSecret };

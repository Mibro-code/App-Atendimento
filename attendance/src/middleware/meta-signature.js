const crypto = require("node:crypto");

function verifyMetaSignature(req, res, next) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    if (process.env.NODE_ENV === "production") {
      return res.status(503).json({ error: "Validação do webhook não configurada." });
    }
    return next();
  }

  const provided = req.get("x-hub-signature-256");
  if (!provided || !req.rawBody) return res.sendStatus(401);
  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(req.rawBody).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    return res.sendStatus(401);
  }
  return next();
}

module.exports = verifyMetaSignature;

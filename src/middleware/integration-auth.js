const crypto = require("node:crypto");

function integrationAuth(req, res, next) {
  const expected = process.env.INTEGRATION_API_SECRET?.trim();
  const authorization = req.get("authorization") || "";
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";

  if (!expected || !supplied) return res.sendStatus(401);
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  if (
    expectedBuffer.length !== suppliedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)
  ) {
    return res.sendStatus(401);
  }
  return next();
}

module.exports = integrationAuth;

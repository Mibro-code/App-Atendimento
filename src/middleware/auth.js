const auth = require("../services/auth-service");

async function authenticate(req, res, next) {
  try {
    const user = await auth.userFromToken(req.cookies[auth.COOKIE_NAME]);
    if (!user) return res.status(401).json({ error: "Autenticação necessária." });
    req.user = auth.publicUser(user);
    return next();
  } catch (error) { return next(error); }
}

async function requirePageAuth(req, res, next) {
  try {
    const user = await auth.userFromToken(req.cookies[auth.COOKIE_NAME]);
    if (!user) return res.redirect("/login.html");
    req.user = auth.publicUser(user);
    return next();
  } catch (error) { return next(error); }
}

async function requireMasterPage(req, res, next) {
  try {
    const user = await auth.userFromToken(req.cookies[auth.COOKIE_NAME]);
    if (!user) return res.redirect("/login.html");
    if (user.role !== "ADMIN") return res.status(403).send("Acesso restrito a conta Master.");
    req.user = auth.publicUser(user);
    return next();
  } catch (error) { return next(error); }
}

module.exports = { authenticate, requireMasterPage, requirePageAuth };

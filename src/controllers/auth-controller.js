const prisma = require("../database/prisma");
const auth = require("../services/auth-service");

const controller = {
  async status(req, res, next) {
    try {
      const setupRequired = (await prisma.user.count()) === 0;
      const user = await auth.userFromToken(req.cookies[auth.COOKIE_NAME]);
      return res.json({ setupRequired, authenticated: Boolean(user), user: user ? auth.publicUser(user) : null });
    } catch (error) { return next(error); }
  },
  async setup(req, res, next) {
    try {
      const user = await auth.setup(req.body);
      auth.setSession(res, user);
      return res.status(201).json({ user: auth.publicUser(user) });
    } catch (error) { return next(error); }
  },
  async login(req, res, next) {
    try {
      const user = await auth.login(req.body);
      auth.setSession(res, user);
      return res.json({ user: auth.publicUser(user) });
    } catch (error) { return next(error); }
  },
  async logout(req, res, next) {
    try {
      await auth.invalidateSession(req.cookies[auth.COOKIE_NAME]);
    } catch (error) { return next(error); }
    auth.clearSession(res);
    return res.sendStatus(204);
  },
};

module.exports = controller;

const bots = require("../services/bot-service");

module.exports = {
  async list(req, res, next) {
    try { return res.json(await bots.listBots(req.user)); }
    catch (error) { return next(error); }
  },

  async detail(req, res, next) {
    try { return res.json(await bots.getBot(req.params.botId, req.user)); }
    catch (error) { return next(error); }
  },

  async create(req, res, next) {
    try { return res.status(201).json(await bots.createBot(req.body, req.user)); }
    catch (error) { return next(error); }
  },

  async update(req, res, next) {
    try { return res.json(await bots.updateBot(req.params.botId, req.body, req.user)); }
    catch (error) { return next(error); }
  },

  async status(req, res, next) {
    try { return res.json(await bots.updateBotStatus(req.params.botId, req.body.status, req.user)); }
    catch (error) { return next(error); }
  },

  async archive(req, res, next) {
    try { return res.json(await bots.archiveBot(req.params.botId, req.user)); }
    catch (error) { return next(error); }
  },

  async schedules(req, res, next) {
    try {
      const schedules = Array.isArray(req.body) ? req.body : req.body.schedules;
      return res.json(await bots.replaceSchedules(req.params.botId, schedules, req.user));
    } catch (error) { return next(error); }
  },

  async createIntent(req, res, next) {
    try { return res.status(201).json(await bots.createIntent(req.params.botId, req.body, req.user)); }
    catch (error) { return next(error); }
  },

  async updateIntent(req, res, next) {
    try {
      return res.json(await bots.updateIntent(
        req.params.botId,
        req.params.intentId,
        req.body,
        req.user,
      ));
    } catch (error) { return next(error); }
  },

  async deleteIntent(req, res, next) {
    try {
      return res.json(await bots.deleteIntent(
        req.params.botId,
        req.params.intentId,
        req.user,
      ));
    } catch (error) { return next(error); }
  },

  async simulate(req, res, next) {
    try {
      return res.json(await bots.simulate(req.params.botId, req.body.message, req.user, {
        state: req.body.state, history: req.body.history,
      }));
    } catch (error) { return next(error); }
  },

  async observations(req, res, next) {
    try { return res.json(await bots.listObservations(req.query, req.user)); }
    catch (error) { return next(error); }
  },
};

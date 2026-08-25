const bots = require("../services/bot-service");
const learning = require("../services/bot-learning-service");
const governance = require("../services/bot-governance-service");
const versions = require("../services/bot-version-service");
const ratings = require("../services/bot-rating-service");
const knowledge = require("../services/bot-knowledge-source-service");

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

  async observationMetrics(req, res, next) {
    try { return res.json(await bots.observationMetrics(req.user)); }
    catch (error) { return next(error); }
  },

  async observationFeedback(req, res, next) {
    try { return res.json(await bots.recordObservationFeedback(req.params.observationId, req.body, req.user)); }
    catch (error) { return next(error); }
  },

  async learningSuggestions(req, res, next) {
    try { return res.json(await learning.listSuggestions(req.query, req.user)); }
    catch (error) { return next(error); }
  },

  async learningMetrics(req, res, next) {
    try { return res.json(await learning.learningMetrics(req.user)); }
    catch (error) { return next(error); }
  },

  async approveLearningSuggestion(req, res, next) {
    try { return res.json(await learning.approveSuggestion(req.params.suggestionId, req.body, req.user)); }
    catch (error) { return next(error); }
  },

  async rejectLearningSuggestion(req, res, next) {
    try { return res.json(await learning.rejectSuggestion(req.params.suggestionId, req.user)); }
    catch (error) { return next(error); }
  },

  async editLearningSuggestion(req, res, next) {
    try { return res.json(await learning.editSuggestion(req.params.suggestionId, req.body, req.user)); }
    catch (error) { return next(error); }
  },

  async analyzeConversationForLearning(req, res, next) {
    try { return res.json(await learning.analyzeConversationManually(req.params.conversationId, req.user)); }
    catch (error) { return next(error); }
  },

  async intentConflicts(req, res, next) {
    try { return res.json(await bots.listIntentConflicts(req.params.botId, req.user)); }
    catch (error) { return next(error); }
  },

  async intentMetrics(req, res, next) {
    try { return res.json(await bots.intentMetrics(req.params.botId, req.user)); }
    catch (error) { return next(error); }
  },

  // Governança / configuração global.
  async globalSettings(req, res, next) {
    try { return res.json(await governance.getGlobalSettingsForManager(req.user)); }
    catch (error) { return next(error); }
  },
  async updateGlobalSettings(req, res, next) {
    try { return res.json(await governance.updateGlobalSettings(req.body, req.user)); }
    catch (error) { return next(error); }
  },
  async activateKillSwitch(req, res, next) {
    try { return res.json(await governance.deactivateAutomation(req.user)); }
    catch (error) { return next(error); }
  },
  async deactivateKillSwitch(req, res, next) {
    try { return res.json(await governance.reactivateAutomation(req.user)); }
    catch (error) { return next(error); }
  },

  // Versionamento.
  async listVersions(req, res, next) {
    try { return res.json(await versions.listVersions(req.params.botId, req.user)); }
    catch (error) { return next(error); }
  },
  async createVersion(req, res, next) {
    try { return res.status(201).json(await versions.createVersion(req.params.botId, req.body, req.user)); }
    catch (error) { return next(error); }
  },
  async previewRestoreVersion(req, res, next) {
    try { return res.json(await versions.previewRestore(req.params.botId, req.params.version, req.user)); }
    catch (error) { return next(error); }
  },
  async restoreVersion(req, res, next) {
    try { return res.json(await versions.restoreVersion(req.params.botId, req.params.version, req.body, req.user)); }
    catch (error) { return next(error); }
  },

  // Avaliação (ratings) e ranking.
  async submitRating(req, res, next) {
    try { return res.status(201).json(await ratings.submitRating(req.body, req.user)); }
    catch (error) { return next(error); }
  },
  async listRatings(req, res, next) {
    try { return res.json(await ratings.listRatings(req.query, req.user)); }
    catch (error) { return next(error); }
  },
  async ratingMetrics(req, res, next) {
    try { return res.json(await ratings.ratingMetrics(req.params.botId, req.query, req.user)); }
    catch (error) { return next(error); }
  },
  async ratingTimeSeries(req, res, next) {
    try { return res.json(await ratings.ratingTimeSeries(req.params.botId, req.query, req.user)); }
    catch (error) { return next(error); }
  },
  async observationTimeSeries(req, res, next) {
    try { return res.json(await ratings.observationTimeSeries(req.params.botId, req.query, req.user)); }
    catch (error) { return next(error); }
  },
  async updateRatingConfig(req, res, next) {
    try { return res.json(await ratings.updateRatingConfig(req.params.botId, req.body, req.user)); }
    catch (error) { return next(error); }
  },
  async ranking(req, res, next) {
    try { return res.json(await ratings.getRanking(req.user)); }
    catch (error) { return next(error); }
  },

  // Base de conhecimento (arquitetura-base).
  async listKnowledgeSources(req, res, next) {
    try { return res.json(await knowledge.listKnowledgeSources(req.query, req.user)); }
    catch (error) { return next(error); }
  },
  async createKnowledgeSource(req, res, next) {
    try { return res.status(201).json(await knowledge.createKnowledgeSource(req.body, req.user)); }
    catch (error) { return next(error); }
  },
  async updateKnowledgeSource(req, res, next) {
    try { return res.json(await knowledge.updateKnowledgeSource(req.params.sourceId, req.body, req.user)); }
    catch (error) { return next(error); }
  },
  async deleteKnowledgeSource(req, res, next) {
    try { return res.json(await knowledge.deleteKnowledgeSource(req.params.sourceId, req.user)); }
    catch (error) { return next(error); }
  },
};

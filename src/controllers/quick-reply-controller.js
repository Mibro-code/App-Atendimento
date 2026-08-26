const quickReplies = require("../services/quick-reply-service");

module.exports = {
  async list(req, res, next) {
    try { return res.json(await quickReplies.listQuickReplies(req.query, req.user)); }
    catch (error) { return next(error); }
  },

  async detail(req, res, next) {
    try { return res.json(await quickReplies.getQuickReply(req.params.id, req.user)); }
    catch (error) { return next(error); }
  },

  async create(req, res, next) {
    try { return res.status(201).json(await quickReplies.createQuickReply(req.body, req.user)); }
    catch (error) { return next(error); }
  },

  async update(req, res, next) {
    try { return res.json(await quickReplies.updateQuickReply(req.params.id, req.body, req.user)); }
    catch (error) { return next(error); }
  },

  async archive(req, res, next) {
    try { return res.json(await quickReplies.archiveQuickReply(req.params.id, req.user)); }
    catch (error) { return next(error); }
  },

  async preview(req, res, next) {
    try { return res.json(quickReplies.previewQuickReplyText(req.body.text || "", req.user)); }
    catch (error) { return next(error); }
  },

  // Seletor do composer (item 7/10) — qualquer atendente autenticado.
  async listForComposer(req, res, next) {
    try { return res.json(await quickReplies.listForComposer(req.query, req.user)); }
    catch (error) { return next(error); }
  },

  async suggestions(req, res, next) {
    try { return res.json(await quickReplies.listSuggestions(req.query, req.user)); }
    catch (error) { return next(error); }
  },

  async setFavorite(req, res, next) {
    try {
      return res.json(await quickReplies.setFavorite(req.params.id, {
        conversationId: req.body.conversationId, favorite: req.body.favorite,
      }, req.user));
    } catch (error) { return next(error); }
  },

  // Nunca envia mensagem — só resolve variáveis e registra o uso (item 8/12/28).
  async use(req, res, next) {
    try {
      return res.json(await quickReplies.useQuickReply(
        req.params.id, { conversationId: req.body.conversationId }, req.user, { source: "AGENT" },
      ));
    } catch (error) { return next(error); }
  },
};

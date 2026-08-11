const inbox = require("../services/inbox-service");
const { sendText } = require("../services/message-service");
const inboxEvents = require("../realtime/inbox-events");

function createInboxController(channel) {
  return {
    async list(req, res, next) {
      try {
        if (req.query.status && !inbox.conversationStatuses.has(req.query.status)) {
          return res.status(400).json({ error: "Status inválido." });
        }
        return res.json(await inbox.listConversations(req.query));
      } catch (error) { return next(error); }
    },
    async detail(req, res, next) {
      try {
        const conversation = await inbox.getConversation(req.params.id);
        if (!conversation) return res.status(404).json({ error: "Conversa não encontrada." });
        return res.json(conversation);
      } catch (error) { return next(error); }
    },
    async summary(_req, res, next) {
      try { return res.json(await inbox.getConversationSummary()); }
      catch (error) { return next(error); }
    },
    async update(req, res, next) {
      try {
        const conversation = await inbox.updateConversation(req.params.id, req.body);
        inboxEvents.publish();
        return res.json(conversation);
      }
      catch (error) { return next(error); }
    },
    async read(req, res, next) {
      try { return res.json(await inbox.markAsRead(req.params.id)); }
      catch (error) { return next(error); }
    },
    async reply(req, res, next) {
      const text = req.body.text?.trim();
      if (!text) return res.status(400).json({ error: "Mensagem é obrigatória." });
      try {
        const result = await sendText({ conversationId: req.params.id, text, sentByUserId: req.user.id, channel });
        inboxEvents.publish();
        return res.status(201).json(result.message);
      } catch (error) { return next(error); }
    },
    async categories(_req, res, next) {
      try { return res.json(await inbox.listCategories()); }
      catch (error) { return next(error); }
    },
    async updateCategory(req, res, next) {
      try {
        const category = await inbox.updateCategory(req.params.id, req.body);
        inboxEvents.publish();
        return res.json(category);
      }
      catch (error) { return next(error); }
    },
    async addNote(req, res, next) {
      try {
        const note = await inbox.addContactNote(req.params.contactId, { ...req.body, authorId: req.user.id });
        inboxEvents.publish();
        return res.status(201).json(note);
      } catch (error) { return next(error); }
    },
  };
}

module.exports = { createInboxController };

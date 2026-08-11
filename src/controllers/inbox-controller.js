const inbox = require("../services/inbox-service");
const prisma = require("../database/prisma");
const { resolveMedia } = require("../services/media-storage-service");
const { finalizeConversation, sendImage, sendText } = require("../services/message-service");
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
    async claim(req, res, next) {
      try {
        const conversation = await inbox.updateConversation(req.params.id, {
          assignedUserId: req.user.id,
          status: "EM_ATENDIMENTO",
        });
        inboxEvents.publish();
        return res.json(conversation);
      } catch (error) { return next(error); }
    },
    async read(req, res, next) {
      try {
        const result = await inbox.markAsRead(req.params.id, { channel });
        inboxEvents.publish();
        return res.json(result);
      }
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
    async replyImage(req, res, next) {
      if (!req.file) return res.status(400).json({ error: "Selecione uma imagem JPG ou PNG." });
      try {
        const result = await sendImage({
          conversationId: req.params.id, buffer: req.file.buffer,
          mimeType: req.file.mimetype, fileName: req.file.originalname,
          caption: req.body.caption, sentByUserId: req.user.id, channel,
        });
        inboxEvents.publish();
        return res.status(201).json(result.message);
      } catch (error) { return next(error); }
    },
    async finalize(req, res, next) {
      try {
        const result = await finalizeConversation({
          conversationId: req.params.id, sentByUserId: req.user.id, channel,
        });
        inboxEvents.publish();
        return res.json(result);
      } catch (error) { return next(error); }
    },
    async media(req, res, next) {
      try {
        const message = await prisma.message.findUnique({
          where: { id: req.params.messageId },
          select: { mediaStorageKey: true, mediaMimeType: true, mediaFileName: true },
        });
        if (!message?.mediaStorageKey) return res.status(404).json({ error: "Mídia não encontrada." });
        res.set({
          "Content-Type": message.mediaMimeType,
          "Content-Disposition": `inline; filename="${encodeURIComponent(message.mediaFileName || "midia")}"`,
          "Cache-Control": "private, max-age=3600",
          "X-Content-Type-Options": "nosniff",
        });
        return res.sendFile(resolveMedia(message.mediaStorageKey));
      } catch (error) { return next(error); }
    },
    async categories(_req, res, next) {
      try { return res.json(await inbox.listCategories()); }
      catch (error) { return next(error); }
    },
    async createCategory(req, res, next) {
      try {
        const category = await inbox.createCategory(req.body);
        inboxEvents.publish();
        return res.status(201).json(category);
      } catch (error) { return next(error); }
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
    async pinNote(req, res, next) {
      try {
        const note = await inbox.setContactNotePinned(req.params.contactId, req.params.noteId, req.body);
        inboxEvents.publish();
        return res.json(note);
      } catch (error) { return next(error); }
    },
    async users(_req, res, next) {
      try { return res.json(await inbox.listUsers()); }
      catch (error) { return next(error); }
    },
  };
}

module.exports = { createInboxController };

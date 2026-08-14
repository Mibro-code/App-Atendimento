const inbox = require("../services/inbox-service");
const prisma = require("../database/prisma");
const { resolveMedia } = require("../services/media-storage-service");
const { finalizeConversation, sendDocument, sendImage, sendText, sendVideo } = require("../services/message-service");
const inboxEvents = require("../realtime/inbox-events");
const authorization = require("../services/authorization-service");

function createInboxController(channel) {
  return {
    async list(req, res, next) {
      try {
        if (req.query.status && !inbox.conversationStatuses.has(req.query.status)) {
          return res.status(400).json({ error: "Status inválido." });
        }
        return res.json(await inbox.listConversations(req.query, req.user));
      } catch (error) { return next(error); }
    },
    async detail(req, res, next) {
      try {
        const conversation = await inbox.getConversation(req.params.id, req.user);
        if (!conversation) return res.status(404).json({ error: "Conversa não encontrada." });
        return res.json(conversation);
      } catch (error) { return next(error); }
    },
    async summary(req, res, next) {
      try { return res.json(await inbox.getConversationSummary(req.user)); }
      catch (error) { return next(error); }
    },
    async alerts(req, res, next) {
      try { return res.json(await inbox.getUserAlerts(req.query, req.user)); }
      catch (error) { return next(error); }
    },
    async update(req, res, next) {
      try {
        const conversation = await inbox.updateConversation(req.params.id, req.body, req.user);
        inboxEvents.publish();
        return res.json(conversation);
      }
      catch (error) { return next(error); }
    },
    async deleteConversation(req, res, next) {
      try {
        const result = await inbox.deleteConversation(req.params.id, req.user);
        inboxEvents.publish();
        return res.json(result);
      } catch (error) { return next(error); }
    },
    async claim(req, res, next) {
      try {
        const conversation = await inbox.updateConversation(req.params.id, {
          assignedUserId: req.user.id,
        }, req.user);
        inboxEvents.publish();
        return res.json(conversation);
      } catch (error) { return next(error); }
    },
    async pinConversation(req, res, next) {
      try {
        const result = await inbox.setConversationPinned(req.params.id, req.body, req.user);
        inboxEvents.publish();
        return res.json(result);
      } catch (error) { return next(error); }
    },
    async read(req, res, next) {
      try {
        await authorization.assertCanViewConversation(req.user, req.params.id);
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
        await authorization.assertCanViewConversation(req.user, req.params.id);
        const result = await sendText({ conversationId: req.params.id, text, sentByUserId: req.user.id, channel });
        inboxEvents.publish();
        return res.status(201).json(result.message);
      } catch (error) { return next(error); }
    },
    async replyImage(req, res, next) {
      if (!req.file) return res.status(400).json({ error: "Selecione uma imagem JPG ou PNG." });
      try {
        await authorization.assertCanViewConversation(req.user, req.params.id);
        const result = await sendImage({
          conversationId: req.params.id, buffer: req.file.buffer,
          mimeType: req.file.mimetype, fileName: req.file.originalname,
          caption: req.body.caption, sentByUserId: req.user.id, channel,
        });
        inboxEvents.publish();
        return res.status(201).json(result.message);
      } catch (error) { return next(error); }
    },
    async replyVideo(req, res, next) {
      if (!req.file) return res.status(400).json({ error: "Selecione um vídeo MP4 ou 3GP." });
      try {
        await authorization.assertCanViewConversation(req.user, req.params.id);
        const result = await sendVideo({
          conversationId: req.params.id, buffer: req.file.buffer,
          mimeType: req.file.mimetype, fileName: req.file.originalname,
          caption: req.body.caption, sentByUserId: req.user.id, channel,
        });
        inboxEvents.publish();
        return res.status(201).json(result.message);
      } catch (error) { return next(error); }
    },
    async replyDocument(req, res, next) {
      if (!req.file) return res.status(400).json({ error: "Selecione um arquivo PDF." });
      try {
        await authorization.assertCanViewConversation(req.user, req.params.id);
        const result = await sendDocument({
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
        await authorization.assertCanViewConversation(req.user, req.params.id);
        const result = await finalizeConversation({
          conversationId: req.params.id, sentByUserId: req.user.id, channel,
        });
        if (!result.alreadyFinalized) await inbox.recordConversationActivity({
          conversationId: req.params.id, actorUserId: req.user.id,
          action: "STATUS_CHANGED", details: { from: result.previousStatus, to: "FINALIZADO" },
        });
        inboxEvents.publish();
        return res.json(result);
      } catch (error) { return next(error); }
    },
    async media(req, res, next) {
      try {
        const message = await prisma.message.findUnique({
          where: { id: req.params.messageId },
          select: { conversationId: true, mediaStorageKey: true, mediaMimeType: true, mediaFileName: true },
        });
        if (!message?.mediaStorageKey) return res.status(404).json({ error: "Mídia não encontrada." });
        await authorization.assertCanViewConversation(req.user, message.conversationId);
        res.set({
          "Content-Type": message.mediaMimeType,
          "Content-Disposition": `inline; filename="${encodeURIComponent(message.mediaFileName || "midia")}"`,
          "Cache-Control": "private, max-age=3600",
          "X-Content-Type-Options": "nosniff",
        });
        return res.sendFile(resolveMedia(message.mediaStorageKey));
      } catch (error) { return next(error); }
    },
    async categories(req, res, next) {
      try { return res.json(await inbox.listCategories(req.user)); }
      catch (error) { return next(error); }
    },
    async createCategory(req, res, next) {
      try {
        const category = await inbox.createCategory(req.body, req.user);
        inboxEvents.publish();
        return res.status(201).json(category);
      } catch (error) { return next(error); }
    },
    async updateCategory(req, res, next) {
      try {
        const category = await inbox.updateCategory(req.params.id, req.body, req.user);
        inboxEvents.publish();
        return res.json(category);
      }
      catch (error) { return next(error); }
    },
    async addNote(req, res, next) {
      try {
        const note = await inbox.addContactNote(req.params.contactId, { ...req.body, authorId: req.user.id }, req.user);
        inboxEvents.publish();
        return res.status(201).json(note);
      } catch (error) { return next(error); }
    },
    async pinNote(req, res, next) {
      try {
        const note = await inbox.setContactNotePinned(req.params.contactId, req.params.noteId, req.body, req.user);
        inboxEvents.publish();
        return res.json(note);
      } catch (error) { return next(error); }
    },
    async deleteNote(req, res, next) {
      try {
        const result = await inbox.deleteContactNote(req.params.contactId, req.params.noteId, req.body, req.user);
        inboxEvents.publish();
        return res.json(result);
      } catch (error) { return next(error); }
    },
    async users(req, res, next) {
      try { return res.json(await inbox.listUsers(req.user)); }
      catch (error) { return next(error); }
    },
  };
}

module.exports = { createInboxController };

const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const multer = require("multer");
const { rateLimit } = require("express-rate-limit");
const prisma = require("./database/prisma");
const MetaCloudChannel = require("./channels/meta-cloud-channel");
const { saveIncoming, updateStatus, sendTextToPhone } = require("./services/message-service");
const { handleIncomingTriage } = require("./services/triage-bot-service");
const { createInboxController } = require("./controllers/inbox-controller");
const authController = require("./controllers/auth-controller");
const { authenticate, requireMasterPage, requirePageAuth } = require("./middleware/auth");
const verifyMetaSignature = require("./middleware/meta-signature");
const integrationAuth = require("./middleware/integration-auth");
const { registerExternalLead } = require("./services/external-lead-service");
const inboxEvents = require("./realtime/inbox-events");
const authorization = require("./services/authorization-service");
const userManagementController = require("./controllers/user-management-controller");
const auditController = require("./controllers/audit-controller");
const { documentMimeTypes } = require("./services/media-storage-service");
const botController = require("./controllers/bot-controller");
const internalChatController = require("./controllers/internal-chat-controller");
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    if (!["image/jpeg", "image/png"].includes(file.mimetype)) {
      return callback(Object.assign(new Error("Envie uma imagem JPG ou PNG."), { statusCode: 400 }));
    }
    return callback(null, true);
  },
}).single("image");
const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    if (!["video/mp4", "video/3gpp", "video/3gp"].includes(file.mimetype)) {
      return callback(Object.assign(new Error("Envie um vídeo MP4 ou 3GP."), { statusCode: 400 }));
    }
    return callback(null, true);
  },
}).single("video");
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    if (!documentMimeTypes.has(file.mimetype)) {
      return callback(Object.assign(new Error("Envie um documento PDF, TXT, Word, Excel ou PowerPoint."), { statusCode: 400 }));
    }
    return callback(null, true);
  },
}).single("document");
const internalFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
}).single("file");

function createApp({ channel = new MetaCloudChannel() } = {}) {
  const app = express();
  if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
  const inbox = createInboxController(channel);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({
    limit: "1mb",
    verify(req, _res, buffer) {
      if (req.originalUrl === "/webhook/whatsapp") req.rawBody = Buffer.from(buffer);
    },
  }));
  app.use(cookieParser());

  app.get("/webhook/whatsapp", (req, res) => {
    if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === process.env.VERIFY_TOKEN) {
      return res.status(200).send(req.query["hub.challenge"]);
    }
    return res.sendStatus(403);
  });

  app.post("/webhook/whatsapp", verifyMetaSignature, async (req, res) => {
    try {
      const events = channel.parseWebhook(req.body);
      let changed = false;
      for (const event of events) {
        if (event.kind === "message") {
          if (["image", "audio", "video", "sticker", "document"].includes(event.type) && event.mediaId) {
            const existing = await prisma.message.findUnique({ where: { externalId: event.externalId }, select: { id: true } });
            if (existing) continue;
            const media = await channel.downloadMedia(event.mediaId, {
              maxSize: event.type === "sticker" ? 500 * 1024
                : (event.type === "image" ? 5 * 1024 * 1024
                  : (event.type === "document" ? 100 * 1024 * 1024 : 16 * 1024 * 1024)),
            });
            event.mediaBuffer = media.buffer;
            event.mediaMimeType = media.mimeType;
            event.mediaFileName ||= media.fileName;
          }
          const result = await saveIncoming(event);
          if (!result.duplicate) {
            if (event.type !== "reaction") await handleIncomingTriage(event, result.message, channel);
            changed = true;
          }
        }
        if (event.kind === "status") {
          const result = await updateStatus(event);
          if (result?.count) changed = true;
        }
      }
      if (changed) inboxEvents.publish();
      return res.status(200).json({ received: true, processed: events.length });
    } catch (error) {
      console.error("Erro ao processar webhook:", error);
      return res.sendStatus(500);
    }
  });

  app.get("/health", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return res.json({ status: "ok", database: "connected" });
    } catch (_error) {
      return res.status(503).json({ status: "error", database: "unavailable" });
    }
  });

  const integrationLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
  app.post("/integrations/leads/atacado", integrationLimiter, integrationAuth, async (req, res, next) => {
    try {
      const result = await registerExternalLead(req.body);
      inboxEvents.publish();
      return res.status(result.duplicate ? 200 : 201).json({ success: true, ...result });
    } catch (error) {
      return next(error);
    }
  });

  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
  app.get("/api/auth/status", authController.status);
  app.post("/api/auth/setup", loginLimiter, authController.setup);
  app.post("/api/auth/login", loginLimiter, authController.login);
  app.post("/api/auth/logout", authController.logout);

  app.get(["/", "/index.html"], requirePageAuth, (_req, res) => res.sendFile(path.join(process.cwd(), "public", "index.html")));
  app.get(["/bots", "/bots.html"], requireMasterPage, (_req, res) => (
    res.sendFile(path.join(process.cwd(), "public", "bots.html"))
  ));
  app.get("/service-worker.js", (_req, res) => {
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    return res.sendFile(path.join(process.cwd(), "public", "service-worker.js"));
  });
  app.use(express.static("public", { index: false }));
  app.use("/api", authenticate);
  app.get("/api/events", inboxEvents.handle);
 app.get("/api/internal-chats", internalChatController.list);
  app.get("/api/internal-chat-users", internalChatController.users);

app.get(
  "/api/internal-chats/:id/messages",
  internalChatController.messages
);

app.post(
  "/api/internal-chats/:id/files",
  internalFileUpload,
  internalChatController.file
);


// Compatibilidade com versões antigas da PWA ainda armazenadas em cache.
app.post(
  "/api/internal-chats/:id/images",
  imageUpload,
  internalChatController.file
);

app.get(
  "/api/internal-messages/:messageId/media",
  internalChatController.media
);

app.post(
  "/api/internal-chats/:id/messages",
  internalChatController.send
);

app.post(
  "/api/internal-chats/:id/read",
  internalChatController.read
);

app.post(
  "/api/internal-chats/direct/:userId",
  internalChatController.direct
);
  app.get("/api/messages", async (req, res, next) => {
    try {
      const scope = await authorization.conversationScope(req.user);
      const rows = await prisma.message.findMany({
        where: { conversation: { is: scope } },
        include: { conversation: { include: { contact: true } } }, orderBy: { occurredAt: "asc" }, take: 500,
      });
      return res.json(rows.map((item) => ({
        id: item.externalId || item.id, from: item.conversation.contact.phone,
        to: item.direction === "ENVIADA" ? item.conversation.contact.phone : undefined,
        name: item.conversation.contact.customName || item.conversation.contact.name || item.conversation.contact.phone,
        type: item.type, text: item.text, timestamp: item.occurredAt.getTime(),
        direction: item.direction === "ENVIADA" ? "sent" : "received",
      })));
    } catch (error) { return next(error); }
  });

  app.post("/api/send", async (req, res) => {
    if (!authorization.isMaster(req.user)) return res.status(403).json({ error: "Somente uma conta Master pode iniciar conversas por número." });
    const { to, message } = req.body;
    if (!to || !message?.trim()) return res.status(400).json({ error: "Número e mensagem são obrigatórios." });
    try {
      const result = await sendTextToPhone({ phone: to, text: message.trim(), channel });
      return res.json({ success: true, data: result.providerData });
    } catch (error) {
      console.error("Erro ao enviar mensagem:", error.response?.data || error.message);
      return res.status(error.statusCode || 500).json({ error: "Não foi possível enviar a mensagem." });
    }
  });

  app.get("/api/conversations", inbox.list);
  app.get("/api/conversations/summary", inbox.summary);
  app.get("/api/alerts", inbox.alerts);
  app.get("/api/meta/status", inbox.metaStatus);
  app.get("/api/meta/templates", inbox.templates);
  app.post("/api/conversations/outbound", inbox.createOutbound);
  app.get("/api/conversations/:id", inbox.detail);
  app.patch("/api/conversations/:id", inbox.update);
  app.post(
    "/api/conversations/:id/signal-transfer",
    inbox.signalTransfer
  );
  app.delete("/api/conversations/:id", inbox.deleteConversation);
  app.post("/api/conversations/:id/claim", inbox.claim);
  app.patch("/api/conversations/:id/pin", inbox.pinConversation);
  app.post("/api/conversations/:id/read", inbox.read);
  app.post("/api/conversations/:id/messages", inbox.reply);
  app.post("/api/conversations/:id/templates", inbox.replyTemplate);
  app.post("/api/conversations/:id/images", imageUpload, inbox.replyImage);
  app.post("/api/conversations/:id/videos", videoUpload, inbox.replyVideo);
  app.post("/api/conversations/:id/documents", documentUpload, inbox.replyDocument);
  app.post("/api/conversations/:id/finalize", inbox.finalize);
  app.get("/api/messages/:messageId/media", inbox.media);
  app.get("/api/categories", inbox.categories);
  app.get("/api/category-visibility", inbox.categoryVisibility);
  app.patch("/api/category-visibility", inbox.updateCategoryVisibility);
  app.post("/api/categories", inbox.createCategory);
  app.patch("/api/categories/:id", inbox.updateCategory);
  app.get("/api/users", inbox.users);
  app.patch(
    "/api/contacts/:contactId/name",
    inbox.updateContactName
  );
  app.post("/api/contacts/:contactId/notes", inbox.addNote);
  app.patch("/api/contacts/:contactId/notes/:noteId", inbox.pinNote);
  app.delete("/api/contacts/:contactId/notes/:noteId", inbox.deleteNote);
  app.get("/api/admin/users", userManagementController.list);
  app.get("/api/admin/audit-logs", auditController.list);
  app.post("/api/admin/users", userManagementController.create);
  app.patch("/api/admin/users/:id", userManagementController.update);
  app.get("/api/team/users", userManagementController.activity);
  app.get("/api/bots", botController.list);
  app.post("/api/bots", botController.create);
  app.get("/api/bots/:botId", botController.detail);
  app.patch("/api/bots/:botId", botController.update);
  app.patch("/api/bots/:botId/status", botController.status);
  app.delete("/api/bots/:botId", botController.archive);
  app.put("/api/bots/:botId/schedules", botController.schedules);
  app.post("/api/bots/:botId/intents", botController.createIntent);
  app.patch("/api/bots/:botId/intents/:intentId", botController.updateIntent);
  app.delete("/api/bots/:botId/intents/:intentId", botController.deleteIntent);
  app.post("/api/bots/:botId/simulate", botController.simulate);

  app.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: error.field === "file" ? "O arquivo deve ter no máximo 100 MB."
          : error.field === "document" ? "O documento deve ter no máximo 100 MB."
          : (error.field === "video" ? "O vídeo deve ter no máximo 16 MB." : "A imagem deve ter no máximo 5 MB."),
      });
    }
    if (!error.statusCode) console.error("Erro interno:", {
      name: error.name,
      message: error.message,
      code: error.code,
    });
    res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : "Erro interno do servidor.",
      ...(error.code ? { code: error.code } : {}),
      ...(error.details ? error.details : {}),
    });
  });
  return app;
}

module.exports = { createApp };

const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const prisma = require("./database/prisma");
const MetaCloudChannel = require("./channels/meta-cloud-channel");
const { saveIncoming, updateStatus, sendTextToPhone } = require("./services/message-service");
const { createInboxController } = require("./controllers/inbox-controller");
const authController = require("./controllers/auth-controller");
const { authenticate, requirePageAuth } = require("./middleware/auth");
const verifyMetaSignature = require("./middleware/meta-signature");

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
      for (const event of events) {
        if (event.kind === "message") await saveIncoming(event);
        if (event.kind === "status") await updateStatus(event);
      }
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

  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
  app.get("/api/auth/status", authController.status);
  app.post("/api/auth/setup", loginLimiter, authController.setup);
  app.post("/api/auth/login", loginLimiter, authController.login);
  app.post("/api/auth/logout", authController.logout);

  app.get(["/", "/index.html"], requirePageAuth, (_req, res) => res.sendFile(path.join(process.cwd(), "public", "index.html")));
  app.use(express.static("public", { index: false }));
  app.use("/api", authenticate);

  app.get("/api/messages", async (_req, res, next) => {
    try {
      const rows = await prisma.message.findMany({
        include: { conversation: { include: { contact: true } } }, orderBy: { occurredAt: "asc" }, take: 500,
      });
      return res.json(rows.map((item) => ({
        id: item.externalId || item.id, from: item.conversation.contact.phone,
        to: item.direction === "ENVIADA" ? item.conversation.contact.phone : undefined,
        name: item.conversation.contact.name || item.conversation.contact.phone,
        type: item.type, text: item.text, timestamp: item.occurredAt.getTime(),
        direction: item.direction === "ENVIADA" ? "sent" : "received",
      })));
    } catch (error) { return next(error); }
  });

  app.post("/api/send", async (req, res) => {
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
  app.get("/api/conversations/:id", inbox.detail);
  app.patch("/api/conversations/:id", inbox.update);
  app.post("/api/conversations/:id/read", inbox.read);
  app.post("/api/conversations/:id/messages", inbox.reply);
  app.get("/api/categories", inbox.categories);
  app.patch("/api/categories/:id", inbox.updateCategory);
  app.post("/api/contacts/:contactId/notes", inbox.addNote);

  app.use((error, _req, res, _next) => {
    if (!error.statusCode) console.error("Erro interno:", {
      name: error.name,
      message: error.message,
      code: error.code,
    });
    res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : "Erro interno do servidor.",
    });
  });
  return app;
}

module.exports = { createApp };

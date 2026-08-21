const chats = require("../services/internal-chat-service");
const inboxEvents = require("../realtime/inbox-events");

module.exports = {
  async users(req, res, next) {
    try {
      return res.json(
        await chats.listAvailableUsers(req.user)
      );
    } catch (error) {
      return next(error);
    }
  },

  async list(req, res, next) {
    try {
      return res.json(
        await chats.listChats(req.user)
      );
    } catch (error) {
      return next(error);
    }
  },

  async messages(req, res, next) {
    try {
      return res.json(
        await chats.listMessages(
          req.params.id,
          req.user
        )
      );
    } catch (error) {
      return next(error);
    }
  },

  async file(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: "Selecione um arquivo de até 100 MB.",
      });
    }

    const message = await chats.sendFile(
      req.params.id,
      req.file,
      req.body.caption,
      req.user
    );

    inboxEvents.publish();

    return res.status(201).json(message);
  } catch (error) {
    return next(error);
  }
},

async media(req, res, next) {
  try {
    const media = await chats.getMessageMedia(
      req.params.messageId,
      req.user
    );

    res.type(media.mimeType || "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `${media.safeImage ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(media.fileName)}`);

    res.setHeader(
      "Cache-Control",
      "private, max-age=86400"
    );

    return res.sendFile(media.path);
  } catch (error) {
    return next(error);
  }
},

  async send(req, res, next) {
    try {
      const message = await chats.sendMessage(
        req.params.id,
        req.body.text,
        req.user
      );

      inboxEvents.publish();

      return res.status(201).json(message);
    } catch (error) {
      return next(error);
    }
  },

  async read(req, res, next) {
    try {
      await chats.markAsRead(
        req.params.id,
        req.user
      );

      return res.json({
        success: true,
      });
    } catch (error) {
      return next(error);
    }
  },

  async direct(req, res, next) {
    try {
      const chat = await chats.openDirectChat(
        req.params.userId,
        req.user
      );

      inboxEvents.publish();

      return res.json(chat);
    } catch (error) {
      return next(error);
    }
  },
};

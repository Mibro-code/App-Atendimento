// Adapter que ENVOLVE a integração Meta/WhatsApp já existente
// (src/channels/meta-cloud-channel.js) na nova interface ChannelAdapter,
// sem alterar uma linha do arquivo original. Zero risco de regressão: todo
// método aqui delega para a classe já testada e em produção.
const { ChannelAdapter } = require("./channel-adapter");
const MetaCloudChannel = require("../../channels/meta-cloud-channel");

class MetaAdapter extends ChannelAdapter {
  constructor(account, channel = new MetaCloudChannel()) {
    super(account);
    this.channel = channel;
  }

  capabilities() {
    return {
      canReceiveMessages: true,
      canSendMessages: true,
      canReceiveMedia: true,
      canSendMedia: true,
      canMarkRead: true,
      supportsPublicQuestions: false,
      supportsReviews: false,
      supportsOAuth: false,
      supportsWebhook: true,
    };
  }

  async sendMessage({ to, text }) {
    return this.channel.sendText(to, text);
  }

  async sendMedia({ to, type, buffer, mimeType, fileName, caption }) {
    const method = { image: "sendImage", video: "sendVideo", document: "sendDocument" }[type];
    if (!method) throw new Error(`Tipo de mídia não suportado pelo WhatsApp: ${type}`);
    return this.channel[method](to, { buffer, mimeType, fileName, caption });
  }

  async markAsRead({ externalMessageId }) {
    return this.channel.markAsRead(externalMessageId);
  }

  normalizeInboundEvent(rawPayload) {
    // A Meta já é tratada pelo webhook/pipeline próprios (app.js + message-
    // service.js); este método existe só para completude da interface —
    // não é usado no fluxo real do WhatsApp nesta fase.
    return this.channel.parseWebhook(rawPayload);
  }

  async testConnection() {
    this.channel.assertConfigured();
    return { status: "CONNECTED" };
  }
}

module.exports = { MetaAdapter };

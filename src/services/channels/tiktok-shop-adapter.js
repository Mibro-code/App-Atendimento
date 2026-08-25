// TikTok Shop (item 26): Customer Service API existe (Get/Send Conversations
// e Messages, webhooks New Conversation/New Message), mas exige acesso/scope
// específico por conta — nunca tratar ausência de scope como erro de código.
const { ChannelAdapter } = require("./channel-adapter");
const { channelError } = require("./channel-constants");

class TikTokShopAdapter extends ChannelAdapter {
  capabilities() {
    return {
      canReceiveMessages: true,
      canSendMessages: true,
      canReceiveMedia: true,
      canSendMedia: false,
      canMarkRead: true,
      supportsPublicQuestions: false,
      supportsReviews: false,
      supportsOAuth: true,
      supportsWebhook: true,
    };
  }

  // Verificação estrutural: confirma que appKey/appSecret/accessToken/shopId
  // estão presentes. A verificação de que a conta TEM o scope
  // seller.customer_service liberado depende de uma chamada que ainda
  // precisa ser validada contra a documentação/conta real — por isso não
  // afirmamos CONNECTED sozinhos aqui.
  async testConnection() {
    const { appKey, appSecret, shopId } = this.account?.config || {};
    const accessToken = this.account?.secrets?.accessToken;
    if (!appKey || !appSecret || !shopId) throw channelError("INVALID_PAYLOAD", "Configure appKey, appSecret e shopId do TikTok Shop.");
    if (!accessToken) {
      return { status: "AUTH_PENDING", message: "Credenciais configuradas, mas autorização (OAuth) ainda não concluída." };
    }
    return {
      status: "NOT_SUPPORTED",
      message: "Acesso ao Customer Service ainda não aprovado/verificado para esta conta.",
    };
  }

  async sendMessage() {
    throw channelError("NOT_SUPPORTED", "Envio via TikTok Shop Customer Service ainda não está disponível para esta conta.");
  }
}

module.exports = { TikTokShopAdapter };

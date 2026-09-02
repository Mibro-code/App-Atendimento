// Amazon Marketplace (item 29): SP-API. NÃO é chat livre como WhatsApp —
// capabilities refletem só o que a Messaging API da Amazon realmente
// permite (contato limitado e regrado por política, ligado a pedidos).
// Autorização pública usa OAuth oficial da SP-API/LWA; aplicações privadas ainda podem usar autoautorização pelo Seller Central.
const axios = require("axios");
const { ChannelAdapter } = require("./channel-adapter");
const { channelError } = require("./channel-constants");

const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";

class AmazonAdapter extends ChannelAdapter {
  capabilities() {
    return {
      canReceiveMessages: false,
      canSendMessages: false,
      canReceiveMedia: false,
      canSendMedia: false,
      canMarkRead: false,
      supportsPublicQuestions: false,
      supportsReviews: false,
      supportsOAuth: true,
      supportsWebhook: false,
    };
  }

  // Só valida o refreshToken junto à LWA — nunca chama a SP-API de negócio
  // (pedidos/mensagens) nesta fase.
  async testConnection() {
    const lwaClientId = process.env.AMAZON_LWA_CLIENT_ID;
    const lwaClientSecret = process.env.AMAZON_LWA_CLIENT_SECRET;
    const { refreshToken } = this.account?.secrets || {};
    if (!lwaClientId || !lwaClientSecret || !refreshToken) {
      throw channelError("INVALID_PAYLOAD", "Configure AMAZON_LWA_CLIENT_ID/AMAZON_LWA_CLIENT_SECRET no servidor e conecte a conta pela Amazon.");
    }
    try {
      await axios.post(LWA_TOKEN_URL, new URLSearchParams({
        grant_type: "refresh_token", refresh_token: refreshToken, client_id: lwaClientId, client_secret: lwaClientSecret,
      }), { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 8000 });
      return { status: "CONNECTED" };
    } catch (error) {
      if (error.response?.status === 400 || error.response?.status === 401) {
        throw channelError("TOKEN_EXPIRED", "refreshToken inválido ou revogado no Seller Central.");
      }
      throw channelError("PROVIDER_ERROR", "Não foi possível validar as credenciais LWA agora.");
    }
  }

  async refreshCredentials() {
    return this.testConnection();
  }
}

module.exports = { AmazonAdapter };

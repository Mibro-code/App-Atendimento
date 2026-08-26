// E-mail (item 28): dois providers, Gmail/Google Workspace e Microsoft 365,
// ambos via OAuth oficial (nunca senha IMAP simples como primeira opção).
// Threading é preservado pelo `threadId`/`conversationId` do próprio
// provider — normalizado como externalConversationId.
const axios = require("axios");
const { ChannelAdapter } = require("./channel-adapter");
const { channelError } = require("./channel-constants");

class EmailAdapter extends ChannelAdapter {
  // account.config.provider: "GMAIL" | "MICROSOFT_365"
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
      // Push (Gmail Pub/Sub watch / Graph subscriptions) fica para uma fase
      // futura — nesta fase o recebimento é por consulta, não webhook.
      supportsWebhook: false,
    };
  }

  async testConnection() {
    const provider = this.account?.config?.provider;
    const accessToken = this.account?.secrets?.accessToken;
    if (!accessToken) throw channelError("AUTH_ERROR", "Conta de e-mail sem accessToken configurado.");
    try {
      if (provider === "GMAIL") {
        await axios.get("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
          headers: { Authorization: `Bearer ${accessToken}` }, timeout: 8000,
        });
      } else if (provider === "MICROSOFT_365") {
        await axios.get("https://graph.microsoft.com/v1.0/me", {
          headers: { Authorization: `Bearer ${accessToken}` }, timeout: 8000,
        });
      } else {
        throw channelError("INVALID_PAYLOAD", "Provider de e-mail deve ser GMAIL ou MICROSOFT_365.");
      }
      return { status: "CONNECTED" };
    } catch (error) {
      if (error.channelErrorCode) throw error;
      if (error.response?.status === 401) throw channelError("TOKEN_EXPIRED", "Token de e-mail expirado ou inválido.");
      throw channelError("PROVIDER_ERROR", "Não foi possível validar a conta de e-mail agora.");
    }
  }
}

module.exports = { EmailAdapter };

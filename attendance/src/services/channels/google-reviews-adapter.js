// Google Reviews / Perfil da Empresa (item 27): OAuth (Google, endpoints
// estáveis) + Business Profile APIs. Entra na Central como tipo REVIEW, não
// como chat. Auto-resposta sempre OFF nesta fase (política do Google exige
// consentimento explícito e configuração própria) — só resposta manual.
const axios = require("axios");
const { ChannelAdapter } = require("./channel-adapter");
const { channelError } = require("./channel-constants");

const ACCOUNTS_URL = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";

class GoogleReviewsAdapter extends ChannelAdapter {
  capabilities() {
    return {
      canReceiveMessages: false,
      canSendMessages: false,
      canReceiveMedia: false,
      canSendMedia: false,
      canMarkRead: false,
      supportsPublicQuestions: false,
      supportsReviews: true,
      supportsOAuth: true,
      supportsWebhook: false,
    };
  }

  async testConnection() {
    const accessToken = this.account?.secrets?.accessToken;
    if (!accessToken) throw channelError("AUTH_ERROR", "Conta do Google sem accessToken configurado.");
    try {
      await axios.get(ACCOUNTS_URL, { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 8000 });
      return { status: "CONNECTED" };
    } catch (error) {
      if (error.response?.status === 401) throw channelError("TOKEN_EXPIRED", "Token do Google expirado.");
      if (error.response?.status === 403) throw channelError("PERMISSION_DENIED", "Scope do Business Profile ausente ou API não habilitada no projeto Google.");
      throw channelError("PROVIDER_ERROR", "Não foi possível validar a conta do Google Business Profile agora.");
    }
  }

  // Estrutura pronta (endpoint de reviews precisa ser reconfirmado contra a
  // versão atual da API no momento de ativar de verdade — Google já migrou
  // essa família de APIs mais de uma vez).
  async fetchReviews({ accountId, locationId }) {
    throw channelError("NOT_SUPPORTED", "Listagem de avaliações ainda não habilitada — confirme o endpoint atual antes de ativar.", { accountId, locationId });
  }

  async replyToReview() {
    throw channelError("NOT_SUPPORTED", "Resposta a avaliação é sempre manual nesta fase (auto-resposta OFF por política).");
  }
}

module.exports = { GoogleReviewsAdapter };

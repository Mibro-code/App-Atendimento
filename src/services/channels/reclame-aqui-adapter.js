// Reclame Aqui (item 31): tratado como canal de reclamações (COMPLAINT),
// não como chat em tempo real. Sem endpoint/contrato oficial confirmado
// nesta fase — adapter fica pronto para configuração, mas não faz chamadas
// reais. Bot automático OFF; resposta é sempre manual.
const { ChannelAdapter } = require("./channel-adapter");
const { channelError } = require("./channel-constants");

class ReclameAquiAdapter extends ChannelAdapter {
  capabilities() {
    return {
      canReceiveMessages: false,
      canSendMessages: false,
      canReceiveMedia: false,
      canSendMedia: false,
      canMarkRead: false,
      supportsPublicQuestions: false,
      supportsReviews: false,
      supportsOAuth: false,
      supportsWebhook: false,
    };
  }

  async testConnection() {
    return {
      status: "NOT_SUPPORTED",
      message: "Adapter do Reclame Aqui aguardando confirmação de documentação/contrato oficial de API.",
    };
  }
}

module.exports = { ReclameAquiAdapter };

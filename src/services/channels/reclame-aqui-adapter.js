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

  // Sem API pública confirmada nesta fase — nunca chamamos endpoint nenhum.
  // Diferenciamos só o status: NOT_CONFIGURED quando nada foi preenchido
  // ainda, NEEDS_CONTRACT quando já há uma tentativa de configuração
  // (companyId) mas o acesso depende de contrato comercial oficial que não
  // temos.
  async testConnection() {
    if (!this.account?.config?.companyId) {
      return {
        status: "NOT_CONFIGURED",
        message: "Nenhuma configuração do Reclame Aqui foi preenchida ainda.",
      };
    }
    return {
      status: "NEEDS_CONTRACT",
      message: "Reclame Aqui exige contrato comercial oficial para acesso à API — nenhum endpoint é chamado sem esse contrato confirmado.",
    };
  }
}

module.exports = { ReclameAquiAdapter };

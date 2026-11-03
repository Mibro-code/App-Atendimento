// Shopee (item 30): skeleton deliberado. NÃO inventamos endpoint — sem
// documentação/contrato confirmado para a conta/região, este adapter fica
// em NOT_IMPLEMENTED/AWAITING_API_ACCESS. A configuração (partnerId,
// partnerKey, shopId, região) já pode ser cadastrada; quando tivermos
// acesso oficial, só este arquivo precisa ganhar implementação real.
const { ChannelAdapter } = require("./channel-adapter");
const { channelError } = require("./channel-constants");

class ShopeeAdapter extends ChannelAdapter {
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
      message: "Adapter da Shopee aguardando confirmação de acesso/documentação oficial da API para esta conta.",
    };
  }
}

module.exports = { ShopeeAdapter };

// Mercado Livre (item 25): OAuth oficial, notificações em tempo real via
// callback HTTP POST (tópicos incluindo perguntas/mensagens). Envio de
// mensagem via Messages API depende de contexto de pedido/pack que ainda
// não validamos em produção — por segurança, canSendMessages fica false até
// confirmarmos o endpoint exato para o cenário da conta.
const axios = require("axios");
const { ChannelAdapter } = require("./channel-adapter");
const { channelError } = require("./channel-constants");

class MercadoLivreAdapter extends ChannelAdapter {
  capabilities() {
    return {
      canReceiveMessages: true,
      canSendMessages: false,
      canReceiveMedia: false,
      canSendMedia: false,
      canMarkRead: false,
      supportsPublicQuestions: true,
      supportsReviews: false,
      supportsOAuth: true,
      supportsWebhook: true,
    };
  }

  async testConnection() {
    const accessToken = this.account?.secrets?.accessToken;
    if (!accessToken) throw channelError("AUTH_ERROR", "Conta do Mercado Livre sem accessToken configurado.");
    try {
      const response = await axios.get("https://api.mercadolibre.com/users/me", {
        headers: { Authorization: `Bearer ${accessToken}` }, timeout: 8000,
      });
      return { status: "CONNECTED", externalAccountId: String(response.data?.id || "") };
    } catch (error) {
      if (error.response?.status === 401) throw channelError("TOKEN_EXPIRED", "Token do Mercado Livre expirado.");
      if (error.response?.status === 403) throw channelError("PERMISSION_DENIED", "Sem permissão para esta conta do Mercado Livre.");
      throw channelError("PROVIDER_ERROR", "Não foi possível validar a conta do Mercado Livre agora.");
    }
  }

  // Notificações do ML chegam como { resource, user_id, topic, application_id,
  // sent, received }; o corpo real (pergunta/mensagem) é buscado depois via
  // GET no `resource`. Aqui só validamos o formato mínimo.
  validateWebhook(req) {
    return Boolean(req.body?.resource && req.body?.topic);
  }

  normalizeInboundEvent(rawPayload) {
    return [{
      channel: "MERCADO_LIVRE",
      externalConversationId: rawPayload.resource || null,
      externalMessageId: `${rawPayload.topic || "event"}:${rawPayload.resource || ""}:${rawPayload.sent || Date.now()}`,
      senderExternalId: rawPayload.user_id ? String(rawPayload.user_id) : null,
      direction: "RECEBIDA",
      type: rawPayload.topic === "questions" ? "question" : "unknown",
      text: null,
      occurredAt: rawPayload.sent || new Date().toISOString(),
      metadata: rawPayload,
    }];
  }
}

module.exports = { MercadoLivreAdapter };

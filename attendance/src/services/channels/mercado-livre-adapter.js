// Mercado Livre (item 25): OAuth oficial, notificações em tempo real via
// callback HTTP POST (tópicos incluindo perguntas/mensagens). Envio real usa
// só os dois endpoints estáveis e documentados da Messages/Q&A API: resposta
// de pergunta pública (/answers) e mensagem pós-venda vinculada a pack
// (/messages/packs/{pack_id}/sellers/{seller_id}). Nada além disso — não
// inventamos endpoint para cenário que não está confirmado.
const axios = require("axios");
const { ChannelAdapter } = require("./channel-adapter");
const { channelError } = require("./channel-constants");
const { refreshAccessToken } = require("./integration-oauth-service");

function mapMercadoLivreError(error, action) {
  const status = error.response?.status;
  if (status === 401) return channelError("TOKEN_EXPIRED", `Token do Mercado Livre expirado ao tentar ${action}.`);
  if (status === 403) return channelError("PERMISSION_DENIED", `Sem permissão para ${action} no Mercado Livre.`);
  if (status === 429) return channelError("RATE_LIMIT", `Limite de requisições do Mercado Livre atingido ao tentar ${action}.`);
  return channelError("PROVIDER_ERROR", `Não foi possível ${action} no Mercado Livre agora.`);
}

class MercadoLivreAdapter extends ChannelAdapter {
  capabilities() {
    return {
      canReceiveMessages: false,
      canSendMessages: true,
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
      return { status: "CONNECTED", externalAccountId: String(response.data?.id || ""), providerMetadata: { displayName: response.data?.nickname || null, username: response.data?.nickname || null } };
    } catch (error) {
      if (error.response?.status === 401) throw channelError("TOKEN_EXPIRED", "Token do Mercado Livre expirado.");
      if (error.response?.status === 403) throw channelError("PERMISSION_DENIED", "Sem permissão para esta conta do Mercado Livre.");
      throw channelError("PROVIDER_ERROR", "Não foi possível validar a conta do Mercado Livre agora.");
    }
  }

  // Dois formatos suportados (item 25): resposta de pergunta pública
  // ({ kind: "question", questionId, text }) e mensagem pós-venda vinculada
  // a um pack ({ kind: "post_sale", packId, buyerUserId, text }). Validação
  // de payload roda ANTES de qualquer chamada HTTP/checagem de token.
  async sendMessage(params = {}) {
    const { kind } = params;
    if (kind === "question") {
      const { questionId, text } = params;
      if (!questionId || !text) throw channelError("INVALID_PAYLOAD", "Responder pergunta do Mercado Livre exige questionId e text.");
      return this._answerQuestion(questionId, text);
    }
    if (kind === "post_sale") {
      const { packId, buyerUserId, text } = params;
      if (!packId || !buyerUserId || !text) throw channelError("INVALID_PAYLOAD", "Mensagem pós-venda do Mercado Livre exige packId, buyerUserId e text.");
      return this._sendPostSaleMessage(packId, buyerUserId, text);
    }
    throw channelError("INVALID_PAYLOAD", `Tipo de envio "${kind}" não é suportado pelo Mercado Livre.`);
  }

  async _answerQuestion(questionId, text) {
    const accessToken = this.account?.secrets?.accessToken;
    if (!accessToken) throw channelError("AUTH_ERROR", "Conta do Mercado Livre sem accessToken configurado.");
    try {
      const response = await axios.post("https://api.mercadolibre.com/answers", {
        question_id: Number(questionId), text,
      }, { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 8000 });
      return { externalMessageId: String(response.data?.id || questionId), raw: response.data };
    } catch (error) {
      throw mapMercadoLivreError(error, "responder pergunta");
    }
  }

  async _sendPostSaleMessage(packId, buyerUserId, text) {
    const accessToken = this.account?.secrets?.accessToken;
    if (!accessToken) throw channelError("AUTH_ERROR", "Conta do Mercado Livre sem accessToken configurado.");
    const sellerId = this.account?.externalAccountId;
    if (!sellerId) throw channelError("INVALID_PAYLOAD", "Conta do Mercado Livre sem externalAccountId (seller_id) — rode o teste de conexão novamente.");
    try {
      const response = await axios.post(
        `https://api.mercadolibre.com/messages/packs/${packId}/sellers/${sellerId}?tag=post_sale`,
        { from: { user_id: sellerId }, to: { user_id: buyerUserId }, text },
        { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 8000 },
      );
      return { externalMessageId: String(response.data?.id || ""), raw: response.data };
    } catch (error) {
      throw mapMercadoLivreError(error, "enviar mensagem pós-venda");
    }
  }

  // Renovação via fluxo OAuth genérico (item 13) — reaproveita
  // integration-oauth-service em vez de reimplementar a troca com axios.
  async refreshCredentials() {
    const refreshToken = this.account?.secrets?.refreshToken;
    if (!refreshToken) throw channelError("AUTH_ERROR", "Conta do Mercado Livre sem refreshToken configurado.");
    const clientId = process.env.MERCADO_LIVRE_CLIENT_ID;
    const clientSecret = process.env.MERCADO_LIVRE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw channelError("AUTH_ERROR", "MERCADO_LIVRE_CLIENT_ID/MERCADO_LIVRE_CLIENT_SECRET não configurados.");
    try {
      return await refreshAccessToken({ provider: "MERCADO_LIVRE", refreshToken, clientId, clientSecret });
    } catch (error) {
      throw channelError(error.channelErrorCode === "TOKEN_EXPIRED" ? "TOKEN_EXPIRED" : "PROVIDER_ERROR", error.message || "Falha ao renovar token do Mercado Livre.");
    }
  }

  // Notificações do ML chegam como { resource, user_id, topic, application_id,
  // sent, received }; o corpo real (pergunta/mensagem) é buscado depois via
  // GET no `resource`. Não existe assinatura HMAC documentada para
  // notificações do ML — a validação real e confirmada é: (a) o payload tem
  // o formato mínimo esperado e (b) application_id bate com o client_id do
  // nosso app, quando essa env var estiver configurada. Nunca lança — só
  // retorna boolean (contrato da base class).
  validateWebhook(req) {
    try {
      const body = req?.body || {};
      const hasExpectedShape = typeof body.resource === "string"
        && typeof body.topic === "string"
        && (typeof body.user_id === "number" || typeof body.user_id === "string")
        && (typeof body.application_id === "number" || typeof body.application_id === "string");
      if (!hasExpectedShape) return false;
      const expectedClientId = process.env.MERCADO_LIVRE_CLIENT_ID;
      if (expectedClientId && String(body.application_id) !== expectedClientId) return false;
      return true;
    } catch (_error) {
      return false;
    }
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

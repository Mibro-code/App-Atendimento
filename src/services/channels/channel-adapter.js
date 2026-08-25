// Contrato interno que todo canal implementa (item 3). Nem todo adapter
// precisa suportar tudo — capabilities() diz honestamente o que cada um faz.
// A Central/Bot nunca falam com a API de terceiros diretamente: sempre por
// aqui.
const { DEFAULT_CAPABILITIES, channelError } = require("./channel-constants");

class ChannelAdapter {
  constructor(account) {
    this.account = account || null;
  }

  // Sobrescrever nos adapters concretos com só as capacidades reais.
  capabilities() {
    return { ...DEFAULT_CAPABILITIES };
  }

  async sendMessage(_params) {
    throw channelError("NOT_SUPPORTED", `${this.constructor.name} não suporta envio de mensagens.`);
  }

  async sendMedia(_params) {
    throw channelError("NOT_SUPPORTED", `${this.constructor.name} não suporta envio de mídia.`);
  }

  async markAsRead(_params) {
    throw channelError("NOT_SUPPORTED", `${this.constructor.name} não suporta marcar como lido.`);
  }

  async fetchConversation(_params) {
    throw channelError("NOT_SUPPORTED", `${this.constructor.name} não suporta buscar conversa.`);
  }

  async fetchMessages(_params) {
    throw channelError("NOT_SUPPORTED", `${this.constructor.name} não suporta buscar mensagens.`);
  }

  // Converte o payload cru do provider em NormalizedInboundMessage[]
  // (ver channel-event-normalizer.js). Deve ser síncrono/puro sempre que
  // possível — I/O pesado não pertence aqui.
  normalizeInboundEvent(_rawPayload) {
    throw channelError("NOT_SUPPORTED", `${this.constructor.name} não implementa normalização de evento.`);
  }

  // Valida assinatura/origem do webhook quando o provider oferecer. Deve
  // retornar boolean — nunca lançar para não derrubar o endpoint.
  validateWebhook(_req) {
    return true;
  }

  // Só verifica credenciais/escopo — nunca envia nada real (item 12).
  async testConnection() {
    throw channelError("NOT_SUPPORTED", `${this.constructor.name} não implementa teste de conexão.`);
  }

  async refreshCredentials() {
    throw channelError("NOT_SUPPORTED", `${this.constructor.name} não suporta refresh de credenciais.`);
  }
}

module.exports = { ChannelAdapter };

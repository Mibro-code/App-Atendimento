// Normalização de telefone para campanhas — reaproveita INTEGRALMENTE a
// mesma função já usada pelo painel para iniciar conversas avulsas
// (outbound-conversation-service.js), nunca duplicando a regra de DDI 55
// (item 6): números BR de 10/11 dígitos (com DDD) ganham o prefixo 55; nunca
// inventa DDD. Fora isso, só garante 8-15 dígitos (E.164 sem "+").
const { normalizeOutboundPhone } = require("./outbound-conversation-service");

// Nunca lança: retorna null para inválido, quem chama decide como reportar
// (import em massa precisa continuar processando as outras linhas).
function normalizeCampaignPhone(value) {
  try {
    return normalizeOutboundPhone(value);
  } catch (_error) {
    return null;
  }
}

module.exports = { normalizeCampaignPhone };

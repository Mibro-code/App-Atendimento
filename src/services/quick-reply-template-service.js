// Substituição segura de variáveis em texto de Resposta Rápida (item 13).
// Nunca executa código: é troca literal de string. Uma variável só é
// substituída se o valor existir no contexto; caso contrário o placeholder
// permanece intacto (nunca inventamos o valor).
const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

const KNOWN_VARIABLES = Object.freeze([
  "firstName", "contactName", "agentName", "botName", "orderNumber", "trackingCode",
]);

function firstNameFrom(fullName) {
  if (!fullName) return null;
  return String(fullName).trim().split(/\s+/)[0] || null;
}

// `context` é livre, mas só os campos com valor não vazio viram substituição
// real — nunca gera texto a partir de dado ausente/indefinido.
function renderTemplate(text, context = {}) {
  if (typeof text !== "string") return { text: "", unresolved: [] };
  const unresolved = [];
  const rendered = text.replace(VARIABLE_PATTERN, (match, name) => {
    const value = context[name];
    if (value === undefined || value === null || value === "") {
      unresolved.push(name);
      return match;
    }
    return String(value);
  });
  return { text: rendered, unresolved: [...new Set(unresolved)] };
}

// Contexto fictício usado só no preview administrativo (item 14) — nunca
// usado no envio real.
function previewContext() {
  return {
    firstName: "Fabio", contactName: "Fabio Almeida", agentName: "Atendente Exemplo",
    botName: "Bot Exemplo", orderNumber: "48213", trackingCode: "BR123456789BR",
  };
}

// Contexto real a partir de uma conversa/usuário — nunca inventa valor: só
// preenche o que já existe nos registros do próprio atendimento.
function contextFromConversation({ conversation, agent } = {}) {
  const contactName = conversation?.contact?.customName || conversation?.contact?.name || null;
  return {
    firstName: firstNameFrom(contactName),
    contactName,
    agentName: agent?.name || null,
  };
}

module.exports = { KNOWN_VARIABLES, contextFromConversation, previewContext, renderTemplate };

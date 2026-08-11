const test = require("node:test");
const assert = require("node:assert/strict");
const { formatTeamMessage, teamLabel } = require("../src/services/team-message-formatter");

test("identifica equipes pelas categorias atuais e futuras", () => {
  assert.equal(teamLabel({ code: "COMERCIAL", name: "Comercial" }), "Comercial");
  assert.equal(teamLabel({ code: "SUPORTE", name: "Suporte" }), "Suporte");
  assert.equal(teamLabel({ code: "FINANCEIRO", name: "💳 Financeiro VIP" }), "💳 Financeiro VIP");
  assert.equal(formatTeamMessage({ code: "SUPORTE", name: "🛠️ Suporte Técnico" }, "Como posso ajudar?"), "*[🛠️ Suporte Técnico]*\n\nComo posso ajudar?");
  assert.equal(formatTeamMessage(null, "Mensagem sem categoria"), "Mensagem sem categoria");
});

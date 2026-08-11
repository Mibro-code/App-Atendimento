const test = require("node:test");
const assert = require("node:assert/strict");
const { formatTeamMessage, teamLabel } = require("../src/services/team-message-formatter");

test("identifica equipes pelas categorias atuais e futuras", () => {
  assert.equal(teamLabel({ code: "COMERCIAL", name: "Comercial" }), "Equipe COMERCIAL");
  assert.equal(teamLabel({ code: "SUPORTE", name: "Suporte" }), "Equipe de Suporte");
  assert.equal(teamLabel({ code: "FINANCEIRO", name: "Financeiro" }), "Equipe de Financeiro");
  assert.equal(formatTeamMessage({ code: "SUPORTE", name: "Suporte" }, "Como posso ajudar?"), "*Equipe de Suporte*\n\nComo posso ajudar?");
  assert.equal(formatTeamMessage(null, "Mensagem sem categoria"), "Mensagem sem categoria");
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { finalizeInactiveConversations } = require("../src/services/conversation-inactivity-service");
test("encaminhamento Q&A aguarda equipe: inatividade não finaliza nem chama aprendizado antigo", async () => {
  let transactions = 0;
  const client = {
    conversation: { findMany: async () => [{ id: "local-only", messages: [{ direction: "ENVIADA", rawPayload: { system: "visual_flow", flowHandoff: true } }] }] },
    $transaction: async () => { transactions++; throw new Error("Não deve finalizar"); },
  };
  assert.equal(await finalizeInactiveConversations({ client }), 0);
  assert.equal(transactions, 0);
});

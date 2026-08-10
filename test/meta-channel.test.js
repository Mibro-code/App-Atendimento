const test = require("node:test");
const assert = require("node:assert/strict");
const MetaCloudChannel = require("../src/channels/meta-cloud-channel");

test("interpreta todas as mensagens e status de um webhook", () => {
  const channel = new MetaCloudChannel();
  const events = channel.parseWebhook({ entry: [{ changes: [{ value: {
    contacts: [{ wa_id: "5511999999999", profile: { name: "Cliente" } }],
    messages: [
      { id: "wamid.1", from: "5511999999999", type: "text", text: { body: "Olá" }, timestamp: "1700000000" },
      { id: "wamid.2", from: "5511999999999", type: "image", timestamp: "1700000001" },
    ],
    statuses: [{ id: "wamid.3", status: "delivered", timestamp: "1700000002" }],
  } }] }] });
  assert.equal(events.length, 3);
  assert.equal(events[0].contactName, "Cliente");
  assert.equal(events[0].text, "Olá");
  assert.equal(events[1].text, "[image]");
  assert.equal(events[2].kind, "status");
});

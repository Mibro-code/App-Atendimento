const test = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");
const fs = require("node:fs");
const path = require("node:path");
const MetaCloudChannel = require("../src/channels/meta-cloud-channel");
const { MetaAdapter } = require("../src/services/channels/meta-adapter");

test("cliente Meta usa credenciais isoladas da ChannelAccount", async () => {
  const previousPost = axios.post;
  let request;
  axios.post = async (url, body, options) => {
    request = { url, body, options };
    return { data: { messages: [{ id: "wamid.second" }] } };
  };
  try {
    const channel = new MetaCloudChannel({ graphVersion:"v99.0", phoneNumberId:"phone-second", accessToken:"token-second", wabaId:"waba-second" });
    const result = await channel.sendText("5511999999999", "Olá");
    assert.equal(result.externalId, "wamid.second");
    assert.match(request.url, /v99\.0\/phone-second\/messages$/);
    assert.equal(request.options.headers.Authorization, "Bearer token-second");
  } finally { axios.post = previousPost; }
});

test("MetaAdapter deriva número, WABA e token da conta", () => {
  const adapter = new MetaAdapter({
    name:"Comercial", externalAccountId:"phone-commercial",
    config:{ wabaId:"waba-commercial", displayPhoneNumber:"+55 11 99999-9999" },
    secrets:{ accessToken:"secret-commercial" },
  });
  assert.equal(adapter.channel.phoneNumberId, "phone-commercial");
  assert.equal(adapter.channel.wabaId, "waba-commercial");
  assert.equal(adapter.channel.accessToken, "secret-commercial");
  assert.equal(adapter.channel.tokenSource, "CHANNEL_ACCOUNT");
});

test("painel e backend preparam atendentes, áreas e escolha do número", () => {
  const integrations = fs.readFileSync(path.join(__dirname, "../public/js/integrations.js"), "utf8");
  const inbox = fs.readFileSync(path.join(__dirname, "../public/js/app.js"), "utf8");
  const authorization = fs.readFileSync(path.join(__dirname, "../src/services/authorization-service.js"), "utf8");
  const webhook = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
  assert.match(integrations, /Phone Number ID/);
  assert.match(integrations, /allowedCategoryIds/);
  assert.match(inbox, /outbound-meta-account/);
  assert.match(authorization, /channelAccountScope/);
  assert.match(webhook, /metadata\?\.phone_number_id/);
});

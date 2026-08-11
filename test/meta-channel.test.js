const test = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");
const MetaCloudChannel = require("../src/channels/meta-cloud-channel");

test("interpreta todas as mensagens e status de um webhook", () => {
  const channel = new MetaCloudChannel();
  const events = channel.parseWebhook({ entry: [{ changes: [{ value: {
    contacts: [{ wa_id: "5511999999999", profile: { name: "Cliente" } }],
    messages: [
      { id: "wamid.1", from: "5511999999999", type: "text", text: { body: "Olá" }, timestamp: "1700000000" },
      { id: "wamid.2", from: "5511999999999", type: "image", image: { id: "media.2", mime_type: "image/jpeg", caption: "Foto do produto" }, timestamp: "1700000001" },
    ],
    statuses: [{ id: "wamid.3", status: "delivered", timestamp: "1700000002" }],
  } }] }] });
  assert.equal(events.length, 3);
  assert.equal(events[0].contactName, "Cliente");
  assert.equal(events[0].text, "Olá");
  assert.equal(events[1].text, "Foto do produto");
  assert.equal(events[1].mediaId, "media.2");
  assert.equal(events[1].mediaMimeType, "image/jpeg");
  assert.equal(events[2].kind, "status");
});

test("baixa e envia imagens usando os endpoints de mídia da Meta", async () => {
  const previousEnv = {
    GRAPH_VERSION: process.env.GRAPH_VERSION,
    PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID,
    WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
  };
  const previousGet = axios.get;
  const previousPost = axios.post;
  process.env.GRAPH_VERSION = "v-test";
  process.env.PHONE_NUMBER_ID = "phone-test";
  process.env.WHATSAPP_TOKEN = "token-test";
  const posts = [];
  axios.get = async (url) => url.includes("graph.facebook.com")
    ? { data: { url: "https://lookaside.fbsbx.com/media/test", mime_type: "image/jpeg" } }
    : { data: Buffer.from([0xff, 0xd8, 0xff, 0x00]), headers: { "content-type": "image/jpeg" } };
  axios.post = async (url, body) => {
    posts.push({ url, body });
    return url.endsWith("/media")
      ? { data: { id: "media.uploaded" } }
      : { data: { messages: [{ id: "wamid.image.sent" }] } };
  };
  try {
    const channel = new MetaCloudChannel();
    const downloaded = await channel.downloadMedia("media.received");
    assert.equal(downloaded.mimeType, "image/jpeg");
    assert.equal(downloaded.buffer.length, 4);
    const sent = await channel.sendImage("5511999999999", {
      buffer: downloaded.buffer, mimeType: downloaded.mimeType, fileName: "foto.jpg", caption: "Legenda",
    });
    assert.equal(sent.externalId, "wamid.image.sent");
    assert.equal(sent.mediaId, "media.uploaded");
    assert.equal(posts.length, 2);
    assert.match(posts[0].url, /phone-test\/media$/);
    assert.match(posts[1].url, /phone-test\/messages$/);
    assert.equal(posts[1].body.image.caption, "Legenda");
  } finally {
    axios.get = previousGet;
    axios.post = previousPost;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { collectAttachmentParts, createLegacyAttachmentMatcher } = require("../src/services/channels/gmail-attachment-identity");
const { createAdapter } = require("../src/services/channels/channel-adapter-registry");
const { normalizeInboundMessage } = require("../src/services/channels/channel-event-normalizer");

const bytes = Buffer.from("synthetic-signature");
function part(partId, downloadId = "rotating") {
  return { ...(partId === undefined ? {} : { partId }), filename: "signature.png", mimeType: "image/png", body: { attachmentId: downloadId } };
}

test("identity uses immutable partId, including zero, and ignores rotating download handles", () => {
  assert.equal(collectAttachmentParts(part("1", "old"))[0].id, "part:1");
  assert.equal(collectAttachmentParts(part("1", "new"))[0].id, "part:1");
  assert.equal(collectAttachmentParts(part(0))[0].id, "part:0");
});

test("nested MIME paths remain distinct without partId, even with identical names and content", () => {
  const payload = { parts: [{ parts: [part(undefined)] }, part(undefined)] };
  assert.deepEqual(collectAttachmentParts(payload).map((p) => p.id), ["path:root.0.0", "path:root.1"]);
});

function harness({ legacy = false, unavailable = false, legacyBytes = bytes, readFailureOnce = false } = {}) {
  const stored = [];
  const events = new Map();
  const reads = [];
  if (legacy) stored.push({ id: "old-row", externalId: "acct:mail:attachment:old-download", channelAccountId: "acct", rawPayload: { id: "mail" }, mediaFileName: "signature.png", mediaMimeType: "image/png", mediaSize: bytes.length, mediaStorageKey: "old-file" });
  const client = {
    channelAccount: { update: async () => ({}) },
    message: { findMany: async ({ where }) => {
      assert.equal(where.channel, "EMAIL");
      assert.equal(where.direction, "RECEBIDA");
      return stored.filter((r) => r.channelAccountId === where.channelAccountId && r.rawPayload.id === where.rawPayload.equals && r.externalId.startsWith(where.externalId.startsWith));
    } },
    externalChannelEvent: {
      findMany: async ({ where }) => [...events.values()].filter((e) => e.status === "PROCESSED" && e.channelAccountId === where.channelAccountId && e.externalEventId.startsWith(where.externalEventId.startsWith)),
      update: async ({ where, data }) => Object.assign(events.get(where.id), data),
    },
  };
  const identity = {
    collectAttachmentParts,
    createLegacyAttachmentMatcher: (options) => createLegacyAttachmentMatcher({ ...options, readFile: async () => {
      if (readFailureOnce) {
        readFailureOnce = false;
        throw Object.assign(new Error("temporary storage failure"), { code: "EIO" });
      }
      if (unavailable) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return legacyBytes;
    } }),
  };
  const dependencies = {
    axios: {}, "../../database/prisma": client, "../../realtime/inbox-events": {},
    "./channel-adapter-registry": { createAdapter }, "./channel-event-normalizer": { normalizeInboundMessage },
    "./integration-secret-service": { decryptSecrets: () => ({ accessToken: "synthetic" }) },
    "./integration-oauth-service": { refreshAccountIfNeeded: async (a) => a },
    "./integration-global-settings-service": {}, "./gmail-attachment-identity": identity,
    "../media-storage-service": { resolveMedia: (key) => key },
    "./external-event-service": {
      recordEvent: async (data) => {
        if (events.has(data.externalEventId)) return { event: events.get(data.externalEventId), isDuplicate: true };
        const event = { ...data, id: data.externalEventId, status: "RECEIVED" };
        events.set(event.id, event);
        return { event, isDuplicate: false };
      },
      markProcessed: async (id) => { events.get(id).status = "PROCESSED"; },
      markError: async (id) => { events.get(id).status = "ERROR"; },
    },
    "./omnichannel-message-service": { persistInboundMessage: async (n) => {
      const externalId = `${n.channelAccountId}:${n.externalMessageId}`;
      if (stored.some((r) => r.externalId === externalId)) return { duplicate: true };
      stored.push({ externalId, channelAccountId: n.channelAccountId, rawPayload: n.metadata, buffer: n.media?.buffer });
      return { duplicate: false };
    } },
  };
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, "../src/services/channels/gmail-sync-service.js"), "utf8");
  vm.runInNewContext(source, { require: (name) => {
    assert.ok(Object.hasOwn(dependencies, name), `unmocked dependency: ${name}`);
    return dependencies[name];
  }, module, Buffer, process: { env: {} }, console });
  let cycle = 0;
  async function sync(accountId = "acct", messageId = "mail", parts = ["1"]) {
    cycle += 1;
    const raw = {
      id: messageId, threadId: "thread", internalDate: "1700000000000",
      payload: { headers: [{ name: "From", value: "test@example.invalid" }], parts: [
        { mimeType: "text/plain", body: { data: Buffer.from("body once").toString("base64url") } },
        ...parts.map((id) => part(id, `download-${cycle}-${id}`)),
      ] },
    };
    const http = { get: async (url) => {
      reads.push(url);
      if (url.endsWith("/messages")) return { data: { messages: [{ id: messageId }] } };
      if (url.includes("/attachments/")) return { data: { data: bytes.toString("base64url") } };
      return { data: raw };
    } };
    return module.exports.syncGmailAccount({ id: accountId, createdAt: new Date("2023-01-01"), config: { gmailSyncLabel: "" } }, { http });
  }
  return { sync, stored, events, reads };
}

test("five polls with rotating download IDs import one text and one attachment", async () => {
  const h = harness();
  assert.equal(await h.sync(), 2);
  for (let i = 0; i < 4; i += 1) assert.equal(await h.sync(), 0);
  assert.equal(h.stored.length, 2);
  assert.ok(h.reads.some((url) => url.endsWith("/attachments/download-5-1")));
  assert.equal(h.stored[1].externalId, "acct:mail:attachment:part:1");
  assert.deepEqual(h.stored[1].buffer, bytes);
});

test("same-content MIME parts, separate emails and separate accounts all remain distinct", async () => {
  const h = harness();
  assert.equal(await h.sync("acct", "mail", ["1", "2"]), 3);
  assert.equal(await h.sync("acct", "other-mail", ["1", "2"]), 3);
  assert.equal(await h.sync("other-acct", "mail", ["1", "2"]), 3);
  assert.equal(h.stored.length, 9);
});

test("legacy attachment is preserved and aliased without reimporting or changing its externalId", async () => {
  const h = harness({ legacy: true });
  assert.equal(await h.sync(), 1); // only the text
  assert.equal(await h.sync(), 0);
  assert.equal(h.stored.length, 2);
  assert.equal(h.stored[0].externalId, "acct:mail:attachment:old-download");
  assert.equal(h.events.get("acct:mail:attachment:part:1").payload.legacyAttachmentMessageId, "old-row");
});

test("legacy row cannot consume two legitimate identical MIME parts, including on later polls", async () => {
  const h = harness({ legacy: true });
  assert.equal(await h.sync(), 1);
  assert.equal(await h.sync("acct", "mail", ["1", "2"]), 1);
  assert.equal(await h.sync("acct", "mail", ["1", "2"]), 0);
  assert.equal(h.stored.length, 3);
});

test("missing legacy file is recovered as a stable attachment instead of silently dropping it", async () => {
  const h = harness({ legacy: true, unavailable: true });
  assert.equal(await h.sync(), 2);
  assert.equal(await h.sync(), 0);
});

test("same name and size with different bytes is not considered an old duplicate", async () => {
  const h = harness({ legacy: true, legacyBytes: Buffer.alloc(bytes.length, 42) });
  assert.equal(await h.sync(), 2);
});

test("same-content legacy attachment in another account or email cannot suppress an import", async () => {
  const h = harness({ legacy: true });
  assert.equal(await h.sync("other-acct"), 2);
  assert.equal(await h.sync("acct", "other-mail"), 2);
});

test("same-content legacy attachment with a different filename is preserved separately", async () => {
  const h = harness({ legacy: true });
  h.stored[0].mediaFileName = "different.png";
  assert.equal(await h.sync(), 2);
});

test("temporary transition read failure is retried without losing or duplicating the attachment", async () => {
  const h = harness({ legacy: true, readFailureOnce: true });
  assert.equal(await h.sync(), 1);
  assert.equal(h.events.get("acct:mail:attachment:part:1").status, "ERROR");
  assert.equal(await h.sync(), 0);
  assert.equal(h.events.get("acct:mail:attachment:part:1").status, "PROCESSED");
  assert.equal(h.stored.length, 2);
});

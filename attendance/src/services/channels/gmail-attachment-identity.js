const fs = require("node:fs/promises");

// attachmentId is a download handle, not an immutable MIME-part identity.
function collectAttachmentParts(payload, result = [], path = "root") {
  if (!payload) return result;
  if (payload.filename && (payload.body?.attachmentId || payload.body?.data)) {
    const id = payload.partId !== undefined && payload.partId !== null && payload.partId !== ""
      ? `part:${payload.partId}` : `path:${path}`;
    result.push({ id, filename: payload.filename, mimeType: payload.mimeType || "application/octet-stream", body: payload.body });
  }
  (payload.parts || []).forEach((part, index) => collectAttachmentParts(part, result, `${path}.${index}`));
  return result;
}

// Transition only: reuse old messages after checking the actual bytes. Never
// delete/rewrite history, merge different emails/accounts, or dedupe by filename.
function createLegacyAttachmentMatcher({ accountId, messageId, client, resolveMedia, readFile = fs.readFile }) {
  let rows;
  const consumed = new Set();
  return async (normalized) => {
    if (!normalized.metadata?.attachment || !normalized.media?.buffer) return false;
    if (!rows) {
      rows = await client.message.findMany({
      where: {
        channel: "EMAIL", channelAccountId: accountId, direction: "RECEBIDA",
        externalId: { startsWith: `${accountId}:${messageId}:attachment:` },
        rawPayload: { path: ["id"], equals: messageId },
      },
      select: { id: true, externalId: true, mediaFileName: true, mediaMimeType: true, mediaSize: true, mediaStorageKey: true },
      orderBy: { createdAt: "asc" },
      });
      const aliases = await client.externalChannelEvent.findMany({
        where: { channel: "EMAIL", channelAccountId: accountId, externalEventId: { startsWith: `${accountId}:${messageId}:attachment:` }, status: "PROCESSED" },
        select: { payload: true },
      });
      for (const alias of aliases) {
        if (alias.payload?.legacyAttachmentMessageId) consumed.add(alias.payload.legacyAttachmentMessageId);
      }
    }
    const prefix = `${accountId}:${messageId}:attachment:`;
    for (const row of rows) {
      const suffix = row.externalId.slice(prefix.length);
      if (suffix.startsWith("part:") || suffix.startsWith("path:") || consumed.has(row.id)
        || row.mediaFileName !== normalized.media.fileName
        || row.mediaMimeType !== normalized.media.mimeType
        || row.mediaSize !== normalized.media.buffer.length || !row.mediaStorageKey) continue;
      let bytes;
      try { bytes = await readFile(resolveMedia(row.mediaStorageKey)); }
      catch (error) { if (error.code === "ENOENT") continue; throw error; }
      if (bytes.equals(normalized.media.buffer)) {
        consumed.add(row.id);
        return row.id;
      }
    }
    return false;
  };
}

module.exports = { collectAttachmentParts, createLegacyAttachmentMatcher };

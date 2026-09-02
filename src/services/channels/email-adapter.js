// E-mail (item 28): dois providers, Gmail/Google Workspace e Microsoft 365,
// ambos via OAuth oficial (nunca senha IMAP simples como primeira opção).
// Threading é preservado pelo `threadId`/`conversationId` do próprio
// provider — normalizado como externalConversationId.
const axios = require("axios");
const { ChannelAdapter } = require("./channel-adapter");
const { channelError } = require("./channel-constants");

const MAX_ATTACHMENTS_BYTES = 20 * 1024 * 1024; // margem de segurança abaixo do limite ~25MB de Gmail/Graph.

function providerFailure(error, fallbackMessage) {
  if (error.channelErrorCode) return error;
  const status = error.response?.status;
  if (status === 401) return channelError("TOKEN_EXPIRED", "Token de e-mail expirado ou inválido.");
  if (status === 403) return channelError("PERMISSION_DENIED", "Sem permissão para esta conta de e-mail.");
  if (status === 429) return channelError("RATE_LIMIT", "Limite de envio de e-mail atingido, tente novamente mais tarde.");
  return channelError("PROVIDER_ERROR", fallbackMessage);
}

// Monta um cabeçalho RFC 2822 dobrando linhas simples (sem folding — assunto
// e destinatários deste app são curtos o bastante para não precisar).
function buildHeaders({ to, subject, contentType, inReplyTo, references, extra = [] }) {
  const headers = [
    `To: ${to}`,
    `Subject: ${subject || ""}`,
    "MIME-Version: 1.0",
  ];
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  if (references) headers.push(`References: ${references}`);
  headers.push(...extra);
  if (contentType) headers.push(`Content-Type: ${contentType}`);
  return headers;
}

function buildGmailSimpleRaw({ to, subject, text, html, inReplyTo, references }) {
  const isHtml = Boolean(html);
  const headers = buildHeaders({
    to, subject, inReplyTo, references,
    contentType: isHtml ? "text/html; charset=UTF-8" : "text/plain; charset=UTF-8",
  });
  const raw = `${headers.join("\r\n")}\r\n\r\n${isHtml ? html : text}`;
  return Buffer.from(raw).toString("base64url");
}

function buildGmailMultipartRaw({ to, subject, text, html, inReplyTo, references, attachments }) {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const isHtml = Boolean(html);
  const headers = buildHeaders({
    to, subject, inReplyTo, references,
    contentType: `multipart/mixed; boundary="${boundary}"`,
  });
  const bodyPart = [
    `--${boundary}`,
    `Content-Type: ${isHtml ? "text/html; charset=UTF-8" : "text/plain; charset=UTF-8"}`,
    "",
    isHtml ? html : text,
    "",
  ].join("\r\n");
  const attachmentParts = attachments.map((attachment) => [
    `--${boundary}`,
    `Content-Type: ${attachment.mimeType || "application/octet-stream"}; name="${attachment.filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${attachment.filename}"`,
    "",
    attachment.buffer.toString("base64"),
    "",
  ].join("\r\n")).join("");
  const raw = `${headers.join("\r\n")}\r\n\r\n${bodyPart}${attachmentParts}--${boundary}--`;
  return Buffer.from(raw).toString("base64url");
}

function stripHtml(html) {
  return String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeGmailBase64Url(data) {
  if (!data) return "";
  return Buffer.from(data, "base64url").toString("utf8");
}

// Percorre `payload.parts` recursivamente à procura da primeira parte
// text/plain (cai para text/html se não houver plain).
function findGmailBodyPart(payload) {
  if (!payload) return null;
  if (payload.mimeType === "text/plain" && payload.body?.data) return { mimeType: "text/plain", data: payload.body.data };
  if (payload.parts) {
    for (const part of payload.parts) {
      const found = findGmailBodyPart(part);
      if (found?.mimeType === "text/plain") return found;
    }
    for (const part of payload.parts) {
      const found = findGmailBodyPart(part);
      if (found) return found;
    }
  }
  if (payload.mimeType === "text/html" && payload.body?.data) return { mimeType: "text/html", data: payload.body.data };
  return null;
}

function gmailHeader(headers, name) {
  const header = (headers || []).find((h) => String(h.name).toLowerCase() === name.toLowerCase());
  return header?.value || null;
}

function parseEmailAddressHeader(value) {
  if (!value) return { address: null, name: null };
  const match = String(value).match(/^(.*?)<(.+)>$/);
  if (match) return { name: match[1].trim().replace(/^"|"$/g, "") || null, address: match[2].trim() };
  return { address: value.trim(), name: null };
}

class EmailAdapter extends ChannelAdapter {
  // account.config.provider: "GMAIL" | "MICROSOFT_365"
  capabilities() {
    return {
      canReceiveMessages: true,
      canSendMessages: true,
      canReceiveMedia: false,
      canSendMedia: true,
      canMarkRead: false,
      supportsPublicQuestions: false,
      supportsReviews: false,
      supportsOAuth: true,
      // Gmail é recebido por polling incremental; push/webhook continua opcional.
      supportsWebhook: false,
    };
  }

  async testConnection() {
    const provider = this.account?.config?.provider;
    const accessToken = this.account?.secrets?.accessToken;
    if (!accessToken) throw channelError("AUTH_ERROR", "Conta de e-mail sem accessToken configurado.");
    try {
      if (provider === "GMAIL") {
        const response = await axios.get("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
          headers: { Authorization: `Bearer ${accessToken}` }, timeout: 8000,
        });
        return { status: "CONNECTED", externalAccountId: response.data?.emailAddress || null, providerMetadata: { displayName: response.data?.emailAddress || null, username: response.data?.emailAddress || null } };
      } else if (provider === "MICROSOFT_365") {
        const response = await axios.get("https://graph.microsoft.com/v1.0/me", {
          headers: { Authorization: `Bearer ${accessToken}` }, timeout: 8000,
        });
        const email = response.data?.mail || response.data?.userPrincipalName || null;
        return { status: "CONNECTED", externalAccountId: response.data?.id || email, providerMetadata: { displayName: response.data?.displayName || email, username: email } };
      } else {
        throw channelError("INVALID_PAYLOAD", "Provider de e-mail deve ser GMAIL ou MICROSOFT_365.");
      }
    } catch (error) {
      if (error.channelErrorCode) throw error;
      if (error.response?.status === 401) throw channelError("TOKEN_EXPIRED", "Token de e-mail expirado ou inválido.");
      throw channelError("PROVIDER_ERROR", "Não foi possível validar a conta de e-mail agora.");
    }
  }

  async sendMessage({ to, subject, text, html, inReplyTo, references, threadId } = {}) {
    if (!to) throw channelError("INVALID_PAYLOAD", "Destinatário (to) é obrigatório para envio de e-mail.");
    if (!text && !html) throw channelError("INVALID_PAYLOAD", "Envio de e-mail exige texto ou html.");
    const provider = this.account?.config?.provider;
    const accessToken = this.account?.secrets?.accessToken;
    if (!accessToken) throw channelError("AUTH_ERROR", "Conta de e-mail sem accessToken configurado.");

    if (provider === "GMAIL") {
      const raw = buildGmailSimpleRaw({ to, subject, text, html, inReplyTo, references });
      try {
        const response = await axios.post(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
          { raw, ...(threadId ? { threadId } : {}) },
          { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, timeout: 15000 },
        );
        return { externalId: response.data?.id, data: response.data };
      } catch (error) {
        throw providerFailure(error, "Não foi possível enviar o e-mail pelo Gmail agora.");
      }
    }

    if (provider === "MICROSOFT_365") {
      try {
        // Comentário para quem chamar este adapter: para preservar thread no
        // Microsoft 365, `inReplyTo` deve ser o id de mensagem do Graph (não
        // um Message-ID RFC) — é o que o endpoint /reply exige.
        if (inReplyTo) {
          const response = await axios.post(
            `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(inReplyTo)}/reply`,
            { comment: text || html },
            { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, timeout: 15000 },
          );
          return { externalId: inReplyTo, data: response.data || null };
        }
        const response = await axios.post(
          "https://graph.microsoft.com/v1.0/me/sendMail",
          {
            message: {
              subject,
              body: { contentType: html ? "HTML" : "Text", content: html || text },
              toRecipients: [{ emailAddress: { address: to } }],
            },
            saveToSentItems: true,
          },
          { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, timeout: 15000 },
        );
        // sendMail não retorna corpo (202); Graph não expõe o id da mensagem enviada nesta chamada.
        return { externalId: null, data: response.data || null };
      } catch (error) {
        throw providerFailure(error, "Não foi possível enviar o e-mail pelo Microsoft 365 agora.");
      }
    }

    throw channelError("INVALID_PAYLOAD", "Provider de e-mail deve ser GMAIL ou MICROSOFT_365.");
  }

  async sendMedia({ to, subject, text, html, attachments, inReplyTo, references, threadId } = {}) {
    if (!to) throw channelError("INVALID_PAYLOAD", "Destinatário (to) é obrigatório para envio de e-mail.");
    if (!Array.isArray(attachments) || attachments.length === 0) {
      throw channelError("INVALID_PAYLOAD", "Envio de mídia por e-mail exige ao menos um anexo.");
    }
    const totalBytes = attachments.reduce((sum, attachment) => sum + (attachment.buffer?.length || 0), 0);
    if (totalBytes > MAX_ATTACHMENTS_BYTES) {
      throw channelError("INVALID_PAYLOAD", "Anexos de e-mail excedem o limite de 20MB.");
    }
    const provider = this.account?.config?.provider;
    const accessToken = this.account?.secrets?.accessToken;
    if (!accessToken) throw channelError("AUTH_ERROR", "Conta de e-mail sem accessToken configurado.");

    if (provider === "GMAIL") {
      const raw = buildGmailMultipartRaw({ to, subject, text, html, inReplyTo, references, attachments });
      try {
        const response = await axios.post(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
          { raw, ...(threadId ? { threadId } : {}) },
          { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, timeout: 20000 },
        );
        return { externalId: response.data?.id, data: response.data };
      } catch (error) {
        throw providerFailure(error, "Não foi possível enviar o anexo pelo Gmail agora.");
      }
    }

    if (provider === "MICROSOFT_365") {
      if (inReplyTo) {
        throw channelError("NOT_SUPPORTED", "Envio de anexo em resposta de thread ainda não suportado para Microsoft 365 — envie sem inReplyTo ou sem anexo.");
      }
      try {
        const response = await axios.post(
          "https://graph.microsoft.com/v1.0/me/sendMail",
          {
            message: {
              subject,
              body: { contentType: html ? "HTML" : "Text", content: html || text || "" },
              toRecipients: [{ emailAddress: { address: to } }],
              attachments: attachments.map((attachment) => ({
                "@odata.type": "#microsoft.graph.fileAttachment",
                name: attachment.filename,
                contentType: attachment.mimeType || "application/octet-stream",
                contentBytes: attachment.buffer.toString("base64"),
              })),
            },
            saveToSentItems: true,
          },
          { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, timeout: 20000 },
        );
        return { externalId: null, data: response.data || null };
      } catch (error) {
        throw providerFailure(error, "Não foi possível enviar o anexo pelo Microsoft 365 agora.");
      }
    }

    throw channelError("INVALID_PAYLOAD", "Provider de e-mail deve ser GMAIL ou MICROSOFT_365.");
  }

  // Normaliza mensagens buscadas pelo worker Gmail ou recebidas do Graph.
  normalizeInboundEvent(rawPayload) {
    if (!rawPayload || typeof rawPayload !== "object") {
      throw channelError("INVALID_PAYLOAD", "Payload de e-mail não reconhecido.");
    }

    // Formato Gmail: payload.headers[] + threadId + id.
    if (rawPayload.payload?.headers || rawPayload.threadId) {
      const headers = rawPayload.payload?.headers || [];
      const from = parseEmailAddressHeader(gmailHeader(headers, "From"));
      const subject = gmailHeader(headers, "Subject");
      const messageId = gmailHeader(headers, "Message-ID");
      const references = gmailHeader(headers, "References");
      const labels = new Set(rawPayload.labelIds || []);
      const gmailMailbox = labels.has("SPAM") ? "SPAM" : labels.has("CATEGORY_PROMOTIONS") ? "PROMOTIONS" : "GENERAL";
      const occurredAt = rawPayload.internalDate ? new Date(Number(rawPayload.internalDate)) : new Date();
      const bodyPart = findGmailBodyPart(rawPayload.payload);
      let text = null;
      if (bodyPart) {
        const decoded = decodeGmailBase64Url(bodyPart.data);
        text = bodyPart.mimeType === "text/html" ? stripHtml(decoded) : decoded;
      }
      const attachments = Array.isArray(rawPayload.gmailAttachments) ? rawPayload.gmailAttachments : [];
      if (attachments.length && /^\[(?:image|document|file|audio|video):[^\]]+\]$/i.test(String(text || "").trim())) text = null;
      const common = {
        channel: "EMAIL", externalConversationId: rawPayload.threadId || null,
        senderExternalId: from.address, senderName: from.name || from.address,
        direction: "RECEBIDA", occurredAt,
      };
      const events = [];
      if (text || !attachments.length) events.push({
        ...common, externalMessageId: rawPayload.id || null,
        type: text ? "text" : "unknown", text,
        metadata: { subject, id: rawPayload.id, threadId: rawPayload.threadId, messageId, references, gmailMailbox },
      });
      attachments.forEach((attachment, index) => {
        const mimeType = String(attachment.mimeType || "application/octet-stream").toLowerCase();
        const type = mimeType.startsWith("image/") ? "image" : mimeType.startsWith("audio/") ? "audio" : mimeType.startsWith("video/") ? "video" : "document";
        events.push({
          ...common, externalMessageId: `${rawPayload.id}:attachment:${attachment.id || index}`,
          type, text: null,
          media: { buffer: attachment.buffer, mimeType, fileName: attachment.filename || "arquivo" },
          metadata: { subject, id: rawPayload.id, threadId: rawPayload.threadId, messageId, references, gmailMailbox, attachment: true },
        });
      });
      return events;
    }

    // Formato Microsoft Graph: subject/from/conversationId/body plano.
    if (rawPayload.conversationId || rawPayload.from?.emailAddress) {
      const address = rawPayload.from?.emailAddress?.address || null;
      const name = rawPayload.from?.emailAddress?.name || null;
      let text = null;
      if (rawPayload.body?.content) {
        text = rawPayload.body.contentType === "html" ? stripHtml(rawPayload.body.content) : rawPayload.body.content;
      }
      return [{
        channel: "EMAIL",
        externalConversationId: rawPayload.conversationId || null,
        externalMessageId: rawPayload.id || null,
        senderExternalId: address,
        senderName: name || address,
        direction: "RECEBIDA",
        type: text ? "text" : "unknown",
        text,
        occurredAt: rawPayload.receivedDateTime ? new Date(rawPayload.receivedDateTime) : new Date(),
        metadata: { subject: rawPayload.subject || null, id: rawPayload.id, conversationId: rawPayload.conversationId },
      }];
    }

    throw channelError("INVALID_PAYLOAD", "Payload de e-mail não reconhecido.");
  }
}

module.exports = { EmailAdapter };

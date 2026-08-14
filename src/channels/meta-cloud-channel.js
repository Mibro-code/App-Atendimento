const axios = require("axios");

class MetaCloudChannel {
  assertConfigured() {
    const required = ["GRAPH_VERSION", "PHONE_NUMBER_ID", "WHATSAPP_TOKEN"];
    for (const key of required) if (!process.env[key]) throw new Error(`Variável ausente: ${key}`);
  }

  apiUrl(resource) {
    return `https://graph.facebook.com/${process.env.GRAPH_VERSION}/${resource}`;
  }

  authHeaders() {
    return { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` };
  }

  providerFailure(error, fallback) {
    const providerError = error.response?.data?.error;
    console.error("Falha segura na Meta Cloud API:", {
      status: error.response?.status,
      code: providerError?.code,
      type: providerError?.type,
      traceId: providerError?.fbtrace_id,
    });
    const message = error.response?.status === 401
      ? "A Meta recusou a credencial do WhatsApp. Atualize o token de acesso."
      : fallback;
    return Object.assign(new Error(message), { statusCode: 502 });
  }

  parseWebhook(body) {
    const events = [];
    for (const entry of body?.entry || []) for (const change of entry?.changes || []) {
      const value = change?.value || {};
      const contacts = new Map((value.contacts || []).map((item) => [item.wa_id, item]));
      for (const message of value.messages || []) {
        const contact = contacts.get(message.from) || value.contacts?.[0];
        const media = ({ image: message.image, audio: message.audio, video: message.video, sticker: message.sticker, document: message.document })[message.type] || null;
        const interactiveReply = message.interactive?.button_reply || message.interactive?.list_reply || null;
        const reaction = message.type === "reaction" ? message.reaction : null;
        events.push({
          kind: "message", externalId: message.id, contactExternalId: message.from,
          phone: message.from, contactName: contact?.profile?.name || message.from,
          type: message.type,
          text: message.type === "text" ? message.text?.body
            : reaction ? reaction.emoji || "" : interactiveReply?.title || media?.caption || `[${message.type}]`,
          interactiveReplyId: interactiveReply?.id || null,
          reactionToExternalId: reaction?.message_id || null,
          reactionEmoji: reaction?.emoji ?? null,
          mediaId: media?.id, mediaMimeType: media?.mime_type,
          mediaFileName: media?.filename || null,
          occurredAt: new Date(Number(message.timestamp) * 1000), rawPayload: message,
        });
      }
      for (const status of value.statuses || []) events.push({
        kind: "status", externalId: status.id, status: status.status,
        occurredAt: new Date(Number(status.timestamp) * 1000), rawPayload: status,
      });
    }
    return events;
  }

  async sendText(to, text) {
    this.assertConfigured();
    try {
      const response = await axios.post(this.apiUrl(`${process.env.PHONE_NUMBER_ID}/messages`), {
        messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: text },
      }, { headers: { ...this.authHeaders(), "Content-Type": "application/json" } });
      return { externalId: response.data?.messages?.[0]?.id, data: response.data };
    } catch (error) {
      throw this.providerFailure(error, "A Meta não aceitou o envio da mensagem.");
    }
  }

  async sendList(to, { body, button, rows }) {
    this.assertConfigured();
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 10) {
      throw Object.assign(new Error("A lista interativa deve ter entre 1 e 10 opções."), { statusCode: 400 });
    }
    try {
      const response = await axios.post(this.apiUrl(`${process.env.PHONE_NUMBER_ID}/messages`), {
        messaging_product: "whatsapp", recipient_type: "individual", to, type: "interactive",
        interactive: {
          type: "list", body: { text: body },
          action: { button, sections: [{ title: "Setores", rows }] },
        },
      }, { headers: { ...this.authHeaders(), "Content-Type": "application/json" } });
      return { externalId: response.data?.messages?.[0]?.id, data: response.data };
    } catch (error) {
      throw this.providerFailure(error, "A Meta não aceitou o envio da lista de setores.");
    }
  }

  async markAsRead(messageId) {
    this.assertConfigured();
    try {
      const response = await axios.put(this.apiUrl(`${process.env.PHONE_NUMBER_ID}/messages`), {
        messaging_product: "whatsapp", status: "read", message_id: messageId,
      }, { headers: { ...this.authHeaders(), "Content-Type": "application/json" } });
      return response.data;
    } catch (error) {
      throw this.providerFailure(error, "A Meta não aceitou a confirmação de leitura.");
    }
  }

  async downloadMedia(mediaId, { maxSize = 16 * 1024 * 1024 } = {}) {
    this.assertConfigured();
    try {
      const metadata = await axios.get(this.apiUrl(mediaId), {
        params: { phone_number_id: process.env.PHONE_NUMBER_ID }, headers: this.authHeaders(),
      });
      const mediaUrl = new URL(metadata.data.url);
      const allowedHost = ["facebook.com", "fbcdn.net", "fbsbx.com"]
        .some((domain) => mediaUrl.hostname === domain || mediaUrl.hostname.endsWith(`.${domain}`));
      if (mediaUrl.protocol !== "https:" || !allowedHost) throw new Error("URL de mídia inesperada.");
      const media = await axios.get(mediaUrl.toString(), {
        responseType: "arraybuffer", headers: this.authHeaders(),
        maxContentLength: maxSize, maxBodyLength: maxSize,
      });
      const mimeType = String(metadata.data.mime_type || media.headers["content-type"] || "").split(";", 1)[0].toLowerCase();
      const extension = ({
        "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "audio/aac": "aac", "audio/mp4": "m4a",
        "audio/mpeg": "mp3", "audio/amr": "amr", "audio/ogg": "ogg",
        "video/mp4": "mp4", "video/3gpp": "3gp", "video/3gp": "3gp",
        "application/pdf": "pdf",
      })[mimeType] || "bin";
      const mediaKind = mimeType === "application/pdf" ? "documento"
        : mimeType === "image/webp" ? "figurinha"
        : (mimeType.startsWith("audio/") ? "audio" : (mimeType.startsWith("video/") ? "video" : "imagem"));
      return {
        buffer: Buffer.from(media.data), mimeType,
        fileName: `${mediaKind}-${mediaId}.${extension}`,
      };
    } catch (error) {
      throw this.providerFailure(error, "Não foi possível baixar a mídia recebida.");
    }
  }

  async sendImage(to, { buffer, mimeType, fileName, caption }) {
    this.assertConfigured();
    try {
      const form = new FormData();
      form.append("messaging_product", "whatsapp");
      form.append("file", new Blob([buffer], { type: mimeType }), fileName);
      const upload = await axios.post(this.apiUrl(`${process.env.PHONE_NUMBER_ID}/media`), form, {
        headers: this.authHeaders(), maxBodyLength: 5 * 1024 * 1024,
      });
      const response = await axios.post(this.apiUrl(`${process.env.PHONE_NUMBER_ID}/messages`), {
        messaging_product: "whatsapp", recipient_type: "individual", to, type: "image",
        image: { id: upload.data.id, ...(caption ? { caption } : {}) },
      }, { headers: { ...this.authHeaders(), "Content-Type": "application/json" } });
      return { externalId: response.data?.messages?.[0]?.id, mediaId: upload.data.id, data: response.data };
    } catch (error) {
      throw this.providerFailure(error, "A Meta não aceitou o envio da imagem.");
    }
  }

  async sendVideo(to, { buffer, mimeType, fileName, caption }) {
    this.assertConfigured();
    try {
      const form = new FormData();
      form.append("messaging_product", "whatsapp");
      form.append("file", new Blob([buffer], { type: mimeType }), fileName);
      const upload = await axios.post(this.apiUrl(`${process.env.PHONE_NUMBER_ID}/media`), form, {
        headers: this.authHeaders(), maxBodyLength: 17 * 1024 * 1024,
      });
      const response = await axios.post(this.apiUrl(`${process.env.PHONE_NUMBER_ID}/messages`), {
        messaging_product: "whatsapp", recipient_type: "individual", to, type: "video",
        video: { id: upload.data.id, ...(caption ? { caption } : {}) },
      }, { headers: { ...this.authHeaders(), "Content-Type": "application/json" } });
      return { externalId: response.data?.messages?.[0]?.id, mediaId: upload.data.id, data: response.data };
    } catch (error) {
      throw this.providerFailure(error, "A Meta não aceitou o envio do vídeo.");
    }
  }

  async sendDocument(to, { buffer, mimeType, fileName, caption }) {
    this.assertConfigured();
    try {
      const form = new FormData();
      form.append("messaging_product", "whatsapp");
      form.append("file", new Blob([buffer], { type: mimeType }), fileName);
      const upload = await axios.post(this.apiUrl(`${process.env.PHONE_NUMBER_ID}/media`), form, {
        headers: this.authHeaders(), maxBodyLength: 101 * 1024 * 1024,
      });
      const response = await axios.post(this.apiUrl(`${process.env.PHONE_NUMBER_ID}/messages`), {
        messaging_product: "whatsapp", recipient_type: "individual", to, type: "document",
        document: { id: upload.data.id, filename: fileName, ...(caption ? { caption } : {}) },
      }, { headers: { ...this.authHeaders(), "Content-Type": "application/json" } });
      return { externalId: response.data?.messages?.[0]?.id, mediaId: upload.data.id, data: response.data };
    } catch (error) {
      throw this.providerFailure(error, "A Meta não aceitou o envio do PDF.");
    }
  }
}

module.exports = MetaCloudChannel;

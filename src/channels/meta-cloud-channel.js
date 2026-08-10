const axios = require("axios");

class MetaCloudChannel {
  parseWebhook(body) {
    const events = [];
    for (const entry of body?.entry || []) for (const change of entry?.changes || []) {
      const value = change?.value || {};
      const contacts = new Map((value.contacts || []).map((item) => [item.wa_id, item]));
      for (const message of value.messages || []) {
        const contact = contacts.get(message.from) || value.contacts?.[0];
        events.push({
          kind: "message", externalId: message.id, contactExternalId: message.from,
          phone: message.from, contactName: contact?.profile?.name || message.from,
          type: message.type, text: message.type === "text" ? message.text?.body : `[${message.type}]`,
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
    const required = ["GRAPH_VERSION", "PHONE_NUMBER_ID", "WHATSAPP_TOKEN"];
    for (const key of required) if (!process.env[key]) throw new Error(`Variável ausente: ${key}`);
    const url = `https://graph.facebook.com/${process.env.GRAPH_VERSION}/${process.env.PHONE_NUMBER_ID}/messages`;
    const response = await axios.post(url, {
      messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: text },
    }, { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" } });
    return { externalId: response.data?.messages?.[0]?.id, data: response.data };
  }
}

module.exports = MetaCloudChannel;

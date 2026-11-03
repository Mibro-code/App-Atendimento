((root) => {
  function create({ newId = () => root.crypto.randomUUID() } = {}) {
    let busy = false;
    const requests = new Map();
    return {
      isSending: () => busy,
      acquire() { if (busy) return false; busy = true; return true; },
      release() { busy = false; },
      request(conversationId, text, proposal) {
        const fingerprint = JSON.stringify([text, proposal || null]);
        const previous = requests.get(conversationId);
        if (previous?.fingerprint === fingerprint) return previous.id;
        const id = newId();
        // Only unresolved drafts remain; cap memory across conversation switches.
        if (requests.size >= 100) requests.delete(requests.keys().next().value);
        requests.set(conversationId, { fingerprint, id });
        return id;
      },
      complete(conversationId, id) { if (requests.get(conversationId)?.id === id) requests.delete(conversationId); },
    };
  }
  root.ComposerSendGuard = { create };
  if (typeof module !== "undefined") module.exports = { create };
})(typeof window !== "undefined" ? window : globalThis);

// Mantém a API dos painéis; baixa o código somente na primeira utilização.
(function optionalPanels() {
  const pending = new Map();

  function load(name, path) {
    if (pending.has(name)) return pending.get(name);
    const placeholder = window[name];
    const request = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = path;
      script.onerror = () => {
        pending.delete(name);
        script.remove();
        reject(new Error("Não foi possível carregar o painel. Tente novamente."));
      };
      script.onload = () => {
        if (window[name] === placeholder) return script.onerror();
        resolve(window[name]);
      };
      document.head.appendChild(script);
    });
    pending.set(name, request);
    return request;
  }

  function panel(name, path, methods) {
    window[name] = Object.fromEntries(methods.map((method) => [method, async (...args) => {
      const loaded = await load(name, path);
      return loaded[method](...args);
    }]));
  }

  panel("WaSupervision", "/js/supervision.js?v=1", ["open", "openTimeline"]);
  panel("ContactProfileUI", "/js/contact-profile-ui.js?v=1", ["open"]);
  document.querySelector("#open-contact-profile")?.addEventListener("click", () => {
    const contactId = window.FollowUpsUI?.currentContactId?.();
    if (!contactId) return;
    window.ContactProfileUI.open(contactId).catch((error) => toast(error.message, true));
  });
})();

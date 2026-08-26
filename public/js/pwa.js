(() => {
  if (!("serviceWorker" in navigator)) return;
  const installButton = document.querySelector("#install-app");
  const checkUpdateButton = document.querySelector("#check-update");
  const updateBanner = document.querySelector("#update-banner");
  const updateButton = document.querySelector("#apply-update");
  const laterButton = document.querySelector("#update-later");
  let installPrompt = null;
  let registration = null;
  let reloading = false;
  let checking = false;
  let buttonResetTimer = null;

  const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const setCheckButton = (label = "", state = "idle") => {
  if (!checkUpdateButton) return;

  clearTimeout(buttonResetTimer);

  const icon = checkUpdateButton.querySelector(".check-update-icon");
  const text = checkUpdateButton.querySelector(".check-update-text");

  checkUpdateButton.dataset.state = state;
  checkUpdateButton.disabled = state === "checking";

  if (state === "ready") {
    if (icon) icon.textContent = "↓";

    if (text) {
      text.textContent = label || "Atualizar";
      text.hidden = false;
    }

    checkUpdateButton.title = "Nova atualização disponível";
    checkUpdateButton.setAttribute(
      "aria-label",
      "Baixar e instalar atualização"
    );

    return;
  }

  if (text) {
    text.textContent = "";
    text.hidden = true;
  }

  if (state === "checking") {
    if (icon) icon.textContent = "↻";
    checkUpdateButton.title = "Verificando atualizações...";
    checkUpdateButton.setAttribute(
      "aria-label",
      "Verificando atualizações"
    );

    return;
  }

  if (state === "current") {
    if (icon) icon.textContent = "✓";
    checkUpdateButton.title = "Aplicativo atualizado";
    checkUpdateButton.setAttribute(
      "aria-label",
      "Aplicativo atualizado"
    );

    return;
  }

  if (state === "error") {
    if (icon) icon.textContent = "!";
    checkUpdateButton.title = "Não foi possível verificar. Clique para tentar novamente.";
    checkUpdateButton.setAttribute(
      "aria-label",
      "Tentar verificar atualizações novamente"
    );

    return;
  }

  if (icon) icon.textContent = "↻";

  checkUpdateButton.title = "Verificar atualizações";
  checkUpdateButton.setAttribute(
    "aria-label",
    "Verificar atualizações"
  );
};


  const resetCheckButtonLater = () => {
  buttonResetTimer = setTimeout(
    () => setCheckButton("", "idle"),
    3500
  );
};

  const showUpdate = () => {
    if (updateBanner) updateBanner.hidden = false;
    setCheckButton("Atualizar agora", "ready");
  };
  const applyUpdate = () => {
    const waitingWorker = registration?.waiting;
    if (!waitingWorker) return false;
    setCheckButton("Atualizando...", "checking");
    if (updateButton) updateButton.disabled = true;
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
    return true;
  };

  const waitForWorker = (worker) => new Promise((resolve) => {
    if (!worker || ["installed", "activated", "redundant"].includes(worker.state)) return resolve(worker?.state);
    const onStateChange = () => {
      if (!["installed", "activated", "redundant"].includes(worker.state)) return;
      worker.removeEventListener("statechange", onStateChange);
      resolve(worker.state);
    };
    worker.addEventListener("statechange", onStateChange);
  });

  const checkForUpdate = async () => {
    if (!registration || checking) return;
    if (registration.waiting && navigator.serviceWorker.controller) {
      applyUpdate();
      return;
    }

    checking = true;
    setCheckButton("Verificando...", "checking");
    try {
      await registration.update();
      if (registration.installing) await waitForWorker(registration.installing);
      if (registration.waiting && navigator.serviceWorker.controller) {
        showUpdate();
      } else {
        setCheckButton("App atualizado", "current");
        resetCheckButtonLater();
      }
    } catch (error) {
      console.warn("Não foi possível verificar atualizações.", error);
      setCheckButton("Tentar novamente", "error");
      resetCheckButtonLater();
    } finally {
      checking = false;
      if (checkUpdateButton?.dataset.state === "checking" && !registration.waiting) {
        checkUpdateButton.disabled = false;
      }
    }
  };

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    if (installButton && !isStandalone()) installButton.hidden = false;
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    if (installButton) installButton.hidden = true;
  });

  installButton?.addEventListener("click", async () => {
    if (!installPrompt) return;
    installButton.disabled = true;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    installButton.hidden = true;
    installButton.disabled = false;
  });

  checkUpdateButton?.addEventListener("click", checkForUpdate);
  updateButton?.addEventListener("click", applyUpdate);
  laterButton?.addEventListener("click", () => { updateBanner.hidden = true; });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  const urlBase64ToUint8Array = (base64) => {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64Safe);
    return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
  };

  // Cria (ou reaproveita) a subscription Web Push e registra no backend (item 4/5 do PWA).
  // Silencioso: chamado tanto após o clique em "Ativar alertas" quanto automaticamente
  // quando a permissão já foi concedida antes.
  window.mibroSubscribePush = async () => {
    if (!("PushManager" in window) || typeof Notification === "undefined" || Notification.permission !== "granted") return false;
    try {
      const activeRegistration = registration || await navigator.serviceWorker.ready;
      let subscription = await activeRegistration.pushManager.getSubscription();
      if (!subscription) {
        const keyResponse = await fetch("/api/push/public-key");
        const { publicKey, enabled } = await keyResponse.json();
        if (!enabled || !publicKey) return false;
        subscription = await activeRegistration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }
      await fetch("/api/push/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      return true;
    } catch (error) {
      console.warn("Não foi possível registrar este dispositivo para notificações.", error);
      return false;
    }
  };

  window.addEventListener("load", async () => {
    try {
      registration = await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
      window.mibroNotify = async (title, options = {}) => {
        if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
        const activeRegistration = registration || await navigator.serviceWorker.ready;
        await activeRegistration.showNotification(title, {
          icon: "/assets/app-icon-192.png", badge: "/assets/app-icon-192.png", ...options,
        });
        return true;
      };
      if (typeof Notification !== "undefined" && Notification.permission === "granted") window.mibroSubscribePush();
      if (checkUpdateButton) checkUpdateButton.hidden = false;
      if (registration.waiting && navigator.serviceWorker.controller) showUpdate();
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) showUpdate();
        });
      });
      setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
    } catch (error) {
      console.warn("Não foi possível registrar o aplicativo instalável.", error);
    }
  });
})();

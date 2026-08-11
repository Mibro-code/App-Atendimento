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
  const setCheckButton = (label, state = "idle") => {
    if (!checkUpdateButton) return;
    clearTimeout(buttonResetTimer);
    checkUpdateButton.textContent = label;
    checkUpdateButton.dataset.state = state;
    checkUpdateButton.disabled = state === "checking";
  };
  const resetCheckButtonLater = () => {
    buttonResetTimer = setTimeout(() => setCheckButton("Verificar atualização"), 3500);
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

  window.addEventListener("load", async () => {
    try {
      registration = await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
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

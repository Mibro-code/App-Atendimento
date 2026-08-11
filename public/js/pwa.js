(() => {
  if (!("serviceWorker" in navigator)) return;
  const installButton = document.querySelector("#install-app");
  const updateBanner = document.querySelector("#update-banner");
  const updateButton = document.querySelector("#apply-update");
  const laterButton = document.querySelector("#update-later");
  let installPrompt = null;
  let registration = null;
  let reloading = false;

  const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const showUpdate = () => { if (updateBanner) updateBanner.hidden = false; };

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

  updateButton?.addEventListener("click", () => {
    updateButton.disabled = true;
    registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
  });
  laterButton?.addEventListener("click", () => { updateBanner.hidden = true; });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      registration = await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
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

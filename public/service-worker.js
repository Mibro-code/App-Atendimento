// Versão do cache da aplicação.
// Altere somente APP_VERSION a cada nova publicação.
const APP_VERSION = "0.16.0";
const CACHE_NAME = `mibro-shell-v${APP_VERSION}`;

const STATIC_ASSETS = [
  "/manifest.webmanifest",

  "/css/app.css",
  "/css/bots.css",
  "/css/login.css",

  "/js/app.js",
  "/js/bots.js",
  "/js/login.js",
  "/js/changelog.js",
  "/js/internal-chat.js",
  "/js/pwa.js",

  "/assets/mibro-logo.png",
  "/assets/app-icon-192.png",
  "/assets/app-icon-512.png",
];

const STATIC_PATHS = new Set(STATIC_ASSETS);

/*
 * INSTALL
 *
 * Prepara todos os arquivos estáticos da nova versão.
 * O worker continua aguardando até o usuário clicar em Atualizar.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

/*
 * ACTIVATE
 *
 * Quando a nova versão assume o controle:
 * - remove caches antigos da Mibro;
 * - mantém somente o cache da versão atual;
 * - assume as abas abertas.
 */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((names) =>
        Promise.all(
          names
            .filter(
              (name) =>
                name.startsWith("mibro-shell-") &&
                name !== CACHE_NAME
            )
            .map((name) => caches.delete(name))
        )
      ),

      self.clients.claim(),
    ])
  );
});

/*
 * O botão "Atualizar" do PWA envia esta mensagem.
 */
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

/*
 * Clique em notificações.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl =
    event.notification.data?.url || "/";

  event.waitUntil(
    clients
      .matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      .then(async (windows) => {
        const existing = windows[0];

        if (existing) {
          await existing.navigate(targetUrl);
          return existing.focus();
        }

        return clients.openWindow(targetUrl);
      })
  );
});

/*
 * FETCH
 *
 * Para CSS, JS, manifest e ícones:
 *
 * 1. tenta buscar a versão atual no servidor;
 * 2. atualiza o cache;
 * 3. usa o cache somente se a rede falhar.
 *
 * Isso evita que um PC continue preso em CSS/JS antigo.
 */
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) return;
  if (!STATIC_PATHS.has(url.pathname)) return;

  event.respondWith(
    fetch(event.request, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);

          await cache.put(
            event.request,
            response.clone()
          );
        }

        return response;
      })
      .catch(async () => {
        const cached = await caches.match(
          event.request
        );

        if (cached) return cached;

        throw new Error(
          `Arquivo indisponível: ${url.pathname}`
        );
      })
  );
});

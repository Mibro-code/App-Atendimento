const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "public", ...parts), "utf8");
const html = read("index.html");
const appJs = read("js", "app.js");
const pwaJs = read("js", "pwa.js");
const sw = read("service-worker.js");
const appCss = read("css", "app.css");
const skeletonCss = read("css", "skeleton.css");

test("service worker recebe Web Push mesmo com o app fechado", () => {
  assert.match(sw, /self\.addEventListener\("push"/);
  assert.match(sw, /self\.registration\.showNotification/);
});

test("service worker não duplica notificação quando já existe janela em foco", () => {
  const pushHandler = sw.match(/self\.addEventListener\("push",[\s\S]*?\n\}\);/)[0];
  assert.match(pushHandler, /clients\.matchAll/);
  assert.match(pushHandler, /focused/);
  assert.match(pushHandler, /if \(hasFocusedWindow\) return;/);
});

test("clique na notificação push abre a conversa correta (mesmo handler do restante do app)", () => {
  const clickHandler = sw.match(/self\.addEventListener\("notificationclick",[\s\S]*?\n\}\);/)[0];
  assert.match(clickHandler, /event\.notification\.data\?\.url/);
  assert.match(clickHandler, /clients\.openWindow\(targetUrl\)/);
});

test("cliente cria a subscription Web Push a partir da VAPID pública e registra no backend", () => {
  assert.match(pwaJs, /window\.mibroSubscribePush = async/);
  assert.match(pwaJs, /pushManager\.subscribe/);
  assert.match(pwaJs, /\/api\/push\/public-key/);
  assert.match(pwaJs, /\/api\/push\/subscriptions/);
});

test("estado visual de conexão perdida/reconectando existe e é debounced (sem loop de toasts)", () => {
  assert.match(html, /id="connection-indicator"/);
  assert.match(appJs, /function setConnectionState/);
  assert.match(appJs, /"Conexão perdida"/);
  assert.match(appJs, /"Reconectando\.\.\."/);
  assert.match(appJs, /events\.addEventListener\("error"/);
  assert.match(appJs, /events\.addEventListener\("open"/);
  // não deve chamar toast() dentro do fluxo de conexão perdida/reconexão
  const realtimeBlock = appJs.match(/function connectRealtime\(\)[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(realtimeBlock, /toast\(/);
});

test("catch up automático ao reconectar, sem travar o atendimento já carregado", () => {
  const realtimeBlock = appJs.match(/function connectRealtime\(\)[\s\S]*?\n\}/)[0];
  assert.match(realtimeBlock, /refreshInbox\(\)\.catch/);
});

test("skeleton de carregamento existe e é distinto do estado vazio", () => {
  assert.match(skeletonCss, /\.skeleton \{/);
  assert.match(html, /skeleton-list/);
  assert.match(appJs, /list\.querySelector\("\.skeleton-list"\)\?\.remove\(\);/);
  assert.match(appJs, /Nenhuma conversa encontrada\./);
});

test("erro de carregamento não deixa o skeleton girando para sempre", () => {
  assert.match(appJs, /Não foi possível carregar as conversas/);
});

test("dispositivos autorizados: dialog, listagem e remoção existem na UI", () => {
  assert.match(html, /id="devices-dialog"/);
  assert.match(html, /id="manage-devices"/);
  assert.match(html, /id="devices-list"/);
  assert.match(appJs, /async function loadDevices/);
  assert.match(appJs, /data-remove-device/);
  assert.match(appJs, /api\(`\/api\/push\/devices\/\$\{encodeURIComponent\(button\.dataset\.removeDevice\)\}`, \{ method:"DELETE" \}\)/);
});

test("revisão tablet 768–1200px existe para sidebar/lista/chat/composer/modais", () => {
  assert.match(appCss, /@media \(max-width:1200px\) and \(min-width:701px\)/);
  assert.match(appCss, /@media \(max-width:1024px\) and \(min-width:701px\)/);
});

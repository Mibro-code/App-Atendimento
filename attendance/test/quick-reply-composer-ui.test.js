const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(process.cwd(), "public", "index.html"), "utf8");
const js = fs.readFileSync(path.join(process.cwd(), "public", "js", "app.js"), "utf8");

test("botão de Respostas rápidas existe no composer sem remover anexo/templates/envio", () => {
  assert.match(html, /id="open-quick-replies"/);
  assert.match(html, /id="attachment-input"/);
  assert.match(html, /id="open-templates"/);
  assert.match(html, /id="send-button"/);
  assert.match(html, /id="message-input"/);
});

test("seletor de respostas rápidas existe como dialog próprio, não substitui o composer", () => {
  assert.match(html, /id="quick-reply-dialog"/);
  assert.match(html, /id="quick-reply-search"/);
  assert.match(html, /id="quick-reply-list"/);
});

test("paste de imagem e upload de anexo continuam com os handlers originais", () => {
  assert.match(js, /\$\("#attachment-input"\)\.addEventListener\("change"/);
  assert.match(js, /\$\("#message-input"\)\.addEventListener\("paste"/);
  assert.match(js, /\$\("#remove-attachment"\)\.addEventListener\("click", clearSelectedAttachment\)/);
});

test("Enter continua enviando e Shift+Enter continua quebrando linha quando não há sugestão de atalho ativa", () => {
  assert.match(js, /if \(event\.key === "Enter" && !event\.shiftKey\) \{ event\.preventDefault\(\); \$\("#composer"\)\.requestSubmit\(\); \}/);
});

test("seleção de resposta rápida nunca chama o endpoint de envio de mensagem", () => {
  assert.doesNotMatch(js.match(/async function selectQuickReply[\s\S]*?\n\}/)[0], /\/api\/conversations\/.*\/messages/);
});

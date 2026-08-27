const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(process.cwd(), "public", "index.html"), "utf8");
const js = fs.readFileSync(path.join(process.cwd(), "public", "js", "app.js"), "utf8");
const css = fs.readFileSync(path.join(process.cwd(), "public", "css", "app.css"), "utf8");

test("textarea do composer continua existindo com o mesmo id/placeholder", () => {
  assert.match(html, /id="message-input" rows="1" maxlength="4096"/);
});

test("altura inicial permanece 44px e o máximo é ~3x (132px), com scroll interno depois disso", () => {
  const rule = css.match(/\.composer textarea \{[^}]+\}/)[0];
  assert.match(rule, /height:44px/);
  assert.match(rule, /min-height:44px/);
  assert.match(rule, /max-height:132px/);
  assert.match(rule, /overflow-y:hidden/);
  assert.match(rule, /resize:none/);
});

test("CSS não permite resize horizontal (resize:none, sem redesenho do composer)", () => {
  const rule = css.match(/\.composer textarea \{[^}]+\}/)[0];
  assert.doesNotMatch(rule, /resize:\s*(horizontal|both)/);
});

test("JS define auto-resize (height:auto -> min(scrollHeight, max)) e reset ao enviar", () => {
  assert.match(js, /const COMPOSER_MIN_HEIGHT = 44;/);
  assert.match(js, /const COMPOSER_MAX_HEIGHT = COMPOSER_MIN_HEIGHT \* 3;/);
  assert.match(js, /function autoResizeComposer\(\)/);
  const autoResizeBody = js.match(/function autoResizeComposer\(\)[\s\S]*?\n\}/)[0];
  assert.match(autoResizeBody, /input\.style\.height = "auto";/);
  assert.match(autoResizeBody, /Math\.min\(Math\.max\(input\.scrollHeight, COMPOSER_MIN_HEIGHT\), COMPOSER_MAX_HEIGHT\)/);
  assert.match(js, /function resetComposerHeight\(\)/);
});

test("o listener de input do composer aciona o auto-resize a cada tecla", () => {
  assert.match(js, /\$\("#message-input"\)\.addEventListener\("input", autoResizeComposer\);/);
});

test("enviar mensagem limpa o texto e reseta a altura do composer", () => {
  assert.match(js, /input\.value = "";\s*resetComposerHeight\(\);\s*hideSlashSuggestions\(\);/);
});

test("inserir resposta rápida ou atalho '\\/' também re-aplica o auto-resize (texto inserido por script)", () => {
  const selectQuickReply = js.match(/async function selectQuickReply\(id\)[\s\S]*?\n\}/)[0];
  assert.match(selectQuickReply, /autoResizeComposer\(\);/);
  const applySlash = js.match(/async function applySlashSuggestion\(index\)[\s\S]*?\n\}/)[0];
  assert.match(applySlash, /autoResizeComposer\(\);/);
});

test("Enter continua enviando e Shift+Enter continua quebrando linha (comportamento preservado)", () => {
  assert.match(js, /if \(event\.key === "Enter" && !event\.shiftKey\) \{ event\.preventDefault\(\); \$\("#composer"\)\.requestSubmit\(\); \}/);
  const keydownHandler = js.match(/\$\("#message-input"\)\.addEventListener\("keydown",[\s\S]*?\n\}\);/)[0];
  // Shift+Enter não tem ramo próprio que chame preventDefault: cai no comportamento
  // padrão do textarea (quebra de linha nativa). Só o Enter puro (sem Shift) é interceptado.
  assert.doesNotMatch(keydownHandler, /if \(event\.shiftKey\)/);
});

test("paste de imagem, anexos e respostas rápidas continuam com os mesmos handlers (nada removido)", () => {
  assert.match(js, /\$\("#attachment-input"\)\.addEventListener\("change"/);
  assert.match(js, /\$\("#message-input"\)\.addEventListener\("paste"/);
  assert.match(js, /\$\("#remove-attachment"\)\.addEventListener\("click", clearSelectedAttachment\)/);
  assert.match(js, /\$\("#open-quick-replies"\)\.addEventListener\("click", openQuickReplyDialog\)/);
});

test("nenhuma regra de mobile sobrescreve a altura do composer (comportamento igual em telas pequenas)", () => {
  const occurrences = css.match(/\.composer textarea\s*\{/g) || [];
  assert.equal(occurrences.length, 1, "a regra .composer textarea deve ser definida uma única vez (sem override de altura em @media)");
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'attendance/public/js/app.js'), 'utf8');
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const context = { encodeURIComponent, escapeHtml, renderWhatsAppText: escapeHtml };
vm.createContext(context);
const previewStart = source.indexOf('const messagePreview =');
const previewEnd = source.indexOf('\nfunction formatFileSize(', previewStart);
const contentStart = source.indexOf('function sharedContactCards(');
const contentEnd = source.indexOf('// Item 27/42', contentStart);
assert.ok(previewStart >= 0 && previewEnd > previewStart && contentStart >= 0 && contentEnd > contentStart);
vm.runInContext(source.slice(previewStart, previewEnd) + '\n' + source.slice(contentStart, contentEnd) + '\nthis.preview = messagePreview;', context);

test('historical unsupported message explains missing content without rewriting original data', () => {
  const message = { id: 'synthetic', type: 'unsupported', text: '[unsupported]', rawPayload: { type: 'unsupported', errors: [{ code: 131051 }], unsupported: { type: 'unknown' } } };
  const before = JSON.stringify(message);
  const html = context.messageContent(message);
  assert.match(html, /Mensagem não suportada/);
  assert.match(html, /não disponibilizou o conteúdo/);
  assert.match(html, /reenvie como foto comum, PDF ou texto/);
  assert.doesNotMatch(html, /\[unsupported\]|href=|<button|<img/);
  assert.match(context.preview(message), /solicitar reenvio/);
  assert.equal(JSON.stringify(message), before);
});

test('unsupported without payload stays readable and never exposes provider data', () => {
  const html = context.messageContent({ type: 'unsupported', text: '<script>bad</script>', rawPayload: { errors: [{ message: 'PRIVATE_PROVIDER_DETAIL' }] } });
  assert.doesNotMatch(html, /script|PRIVATE_PROVIDER_DETAIL/);
  assert.match(context.messageContent({ type: 'unsupported' }), /Mensagem não suportada/);
});

test('normal text and supported attachments preserve existing rendering', () => {
  assert.equal(context.messageContent({ type: 'text', text: '<hello>' }), '<p>&lt;hello&gt;</p>');
  assert.equal(context.preview({ type: 'document', mediaFileName: 'fixture.pdf' }), '📄 fixture.pdf');
  assert.match(context.messageContent({ type: 'image', id: 'fixture', mediaStorageKey: 'synthetic', text: '[image]' }), /<img/);
  assert.equal(context.preview(null), 'Conversa sem mensagens');
});

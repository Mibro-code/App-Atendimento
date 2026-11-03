const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/js/campaigns.js'), 'utf8');
function fixture() {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { value: '', hidden: true, innerHTML: '', textContent: '', listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } });
    return elements.get(id);
  };
  const state = { templatesAccountId: 'account-a', templates: [{ name: 'same_name', language: 'pt_BR', status: 'APPROVED', category: 'MARKETING' }], routingCanEdit: true };
  let resolveOptions;
  const calls = [];
  const context = {
    state, URLSearchParams, encodeURIComponent, decodeURIComponent,
    $: element, document: { querySelectorAll: () => [] }, escapeHtml: String, toast() {}, ensureTemplatesLoaded: async () => {},
    api: async (url, options) => {
      calls.push({ url, options });
      if (url.startsWith('/api/template-routing/options')) return new Promise((resolve) => { resolveOptions = resolve; });
      if (url.startsWith('/api/template-routing/history')) return [];
      return {};
    },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('const routingStateLabels'), source.indexOf('$("#sync-templates").addEventListener')), context);
  return { state, context, element, calls, options: (value = { categories: [] }) => resolveOptions(value) };
}
test('resposta atrasada de opções não abre modal de outra conta', async () => {
  const f = fixture();
  const opening = f.context.openRoutingModal('same_name', 'pt_BR');
  f.state.templatesAccountId = 'account-b';
  f.options(); await opening;
  assert.equal(f.element('#template-routing-modal').hidden, true);
});
test('salvar e consultar histórico mantêm a conta capturada ao abrir', async () => {
  const f = fixture();
  const opening = f.context.openRoutingModal('same_name', 'pt_BR');
  f.options(); await opening;
  assert.equal(f.element('#template-routing-modal').hidden, false);
  f.state.templatesAccountId = 'account-b';
  await f.element('#show-routing-history').listeners.click();
  const history = f.calls.find((call) => call.url.startsWith('/api/template-routing/history'));
  assert.equal(new URLSearchParams(history.url.split('?')[1]).get('channelAccountId'), 'account-a');
  f.element('#routing-category').value = 'category';
  f.element('#routing-enabled').checked = true;
  await f.element('#template-routing-form').listeners.submit({ preventDefault() {} });
  const save = f.calls.find((call) => call.options?.method === 'PUT');
  assert.equal(JSON.parse(save.options.body).channelAccountId, 'account-a');
});
test('fechar o modal invalida uma abertura em andamento', async () => {
  const f = fixture();
  const opening = f.context.openRoutingModal('same_name', 'pt_BR');
  f.context.closeRoutingModal(); f.options(); await opening;
  assert.equal(f.element('#template-routing-modal').hidden, true);
});

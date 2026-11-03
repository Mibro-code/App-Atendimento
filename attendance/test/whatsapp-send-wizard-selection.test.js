// Exercise the shipped event handlers in memory. Rendering is replaced by a
// footer capture; no API calls, browser session, database or sending provider.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = fs.readFileSync(require.resolve('../public/js/whatsapp-send-wizard.js'), 'utf8');
const template = (variables = [{ key: 'body_name', placeholder: 'nome', label: 'Nome', component: 'BODY' }]) => ({ name: 'boas_vindas', language: 'pt_BR', supported: true, variables });
function harness() {
  const ui = { footer: '', renders: 0, sides: 0, inputs: [] };
  const ctx = vm.createContext({ window: {}, location: { hash: '' }, URLSearchParams, crypto,
    document: { getElementById: () => ({ querySelectorAll: () => ui.inputs }) },
    state: { currentUser: { id: 'synthetic-user', name: 'Suelene teste', canStartWhatsAppConversations: true } },
    companyQuery: () => 'mibro', escapeHtml: s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    setTimeout: () => 0, clearTimeout: () => {}, toast: () => {},
    api: async () => { throw Error('Unexpected API call in selection test'); }, ui,
  });
  const code = source.replace('function render() {', 'function renderOriginal() {')
    .replace('function refreshSide() {', 'function refreshSideOriginal() {')
    .replace('function refreshFooter() {', 'function refreshFooterOriginal() {')
    .replace('  window.WaSendWizard = {', `
      function render(){ui.renders++;ui.footer=footerMarkup();}
      function refreshSide(){ui.sides++;}
      function refreshFooter(){ui.footer=footerMarkup();}
      window.selectionTest={freshState,onClick,onInput,loadTemplates,individualBlockers,setState:value=>S=value};
      window.WaSendWizard = {`);
  vm.runInContext(code, ctx);
  const api = ctx.window.selectionTest, s = api.freshState({ modes: { individual: true, bulk: false } });
  s.accountId = 'number-a'; s.numbers = [{ id: 'number-a', available: true }]; s.templates = [template()]; api.setState(s);
  const click = dataset => api.onClick({ target: { closest: () => ({ dataset, disabled: false }) } });
  const input = (dataset, value) => api.onInput({ target: { dataset, value, closest: () => ({ classList: { toggle() {} }, querySelector: () => ({}) }) } });
  const select = () => click({ waIndTemplate: 'boas_vindas|pt_BR' });
  const contact = async (name = 'Ana Souza') => { s.individual.matches = [{ name, phone: '5511999999999' }]; await click({ waContactResult: '0' }); };
  const ready = () => !ui.footer.includes('data-wa-send-individual disabled');
  return { ctx, api, s, ui, click, input, select, contact, ready };
}

test('contact then template enables send and fills name', async () => {
  const h = harness(); await h.contact(); await h.select();
  assert.equal(h.s.individual.values.body_name, 'Ana Souza'); assert.equal(h.ready(), true);
});
test('template then contact gives the same filled values and enables send', async () => {
  const h = harness(); await h.select(); assert.equal(h.ready(), false); await h.contact();
  assert.equal(h.s.individual.values.body_name, 'Ana Souza'); assert.equal(h.ready(), true);
});
test('name typed last refreshes button and visible automatic variable without rerendering the form', async () => {
  const h = harness(); h.s.individual.phone = '+5511999999999'; await h.select(); const renders = h.ui.renders;
  const field = { dataset: { waIndVar: 'body_name' }, value: '' }; h.ui.inputs.push(field);
  h.input({ waInd: 'name' }, 'Ana Souza');
  assert.equal(field.value, 'Ana Souza'); assert.equal(h.ready(), true); assert.equal(h.ui.renders, renders);
});
test('manual values survive contact changes and selecting the same template again', async () => {
  const h = harness(); await h.select(); await h.contact(); h.input({ waIndVar: 'body_name' }, 'Equipe de compras');
  await h.contact('Beatriz Santos'); await h.select();
  assert.equal(h.s.individual.values.body_name, 'Equipe de compras'); assert.equal(h.ready(), true);
});
test('manually cleared variable stays empty and explains why sending is blocked', async () => {
  const h = harness(); await h.contact(); await h.select(); h.input({ waIndVar: 'body_name' }, ''); await h.contact('Beatriz Santos');
  assert.equal(h.s.individual.values.body_name, ''); assert.equal(h.ready(), false); assert.match(h.ui.footer, /Preencha as variáveis: Nome/);
});
test('automatic first name follows new contact, while manually edited variables remain', async () => {
  const h = harness(); h.s.templates = [template([{ key: 'first', placeholder: 'primeiro_nome' }, { key: 'agent', placeholder: 'vendedor' }])];
  await h.select(); await h.contact(); h.input({ waIndVar: 'agent' }, 'Vendedor escolhido'); await h.contact('Beatriz Santos');
  assert.equal(h.s.individual.values.first, 'Beatriz'); assert.equal(h.s.individual.values.agent, 'Vendedor escolhido');
});
test('unknown variables require explicit input and missing labels are escaped', async () => {
  const h = harness(); h.s.templates = [template([{ key: 'price', placeholder: 'preco', label: '<valor>' }])]; await h.contact(); await h.select();
  assert.equal(h.ready(), false); assert.match(h.ui.footer, /&lt;valor&gt;/); h.input({ waIndVar: 'price' }, '0'); assert.equal(h.ready(), true);
});
test('phone and account remain required; entering phone last rechecks the button', async () => {
  const h = harness(); h.input({ waInd: 'name' }, 'Ana'); await h.select(); assert.equal(h.ready(), false);
  h.input({ waInd: 'phone' }, '11999999999'); assert.equal(h.ready(), true);
  h.s.accountId = null; assert.match(h.api.individualBlockers().join(' '), /Selecione o número/);
});
test('switching number clears template from previous account', async () => {
  const h = harness(); await h.contact(); await h.select(); h.ctx.api = async () => [template()]; await h.click({ waNumber: 'number-b' });
  assert.equal(h.s.individual.template, null); assert.equal(h.ready(), false);
});
test('late response from previous number cannot replace current templates', async () => {
  const h = harness(), pending = []; h.ctx.api = () => new Promise(resolve => pending.push(resolve));
  const first = h.api.loadTemplates(); h.s.accountId = 'number-b'; const second = h.api.loadTemplates();
  pending[1]([{ ...template(), name: 'current_number' }]); await second;
  pending[0]([{ ...template(), name: 'old_number' }]); await first;
  assert.equal(h.s.templates[0].name, 'current_number'); assert.equal(h.s.templatesLoading, false);
});
test('using existing-contact shortcut also fills automatic variables', async () => {
  const h = harness(); await h.select(); h.s.individual.existing = { name: 'Ana Souza', phone: '5511999999999' }; await h.click({ waUseExisting: '' });
  assert.equal(h.s.individual.values.body_name, 'Ana Souza'); assert.equal(h.ready(), true);
});

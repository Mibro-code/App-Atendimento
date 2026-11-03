const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
test('gráficos somam o mesmo autor em números diferentes e escapam nomes', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/custos-meta.js'), 'utf8');
  const elements = new Map();
  const document = { querySelector: (key) => { if (!elements.has(key)) elements.set(key, {}); return elements.get(key); } };
  const context = { document, Intl };
  vm.createContext(context);
  vm.runInContext(source.slice(0, source.indexOf('function renderReport')) + source.slice(source.indexOf('function costBars'), source.indexOf('async function loadReport')), context);
  context.renderAuthorCosts([
    { userId: 'a', authorName: '<Autor A>', source: 'USER', channelAccountId: 'n1', accountName: 'Principal', estimatedCost: 0.32, messages: 1, templates: 1, serviceMessages: 0, unpricedCount: 0 },
    { userId: 'a', authorName: '<Autor A>', source: 'USER', channelAccountId: 'n2', accountName: 'Comercial', estimatedCost: 0.32, messages: 1, templates: 1, serviceMessages: 0, unpricedCount: 0 },
  ]);
  const chart = elements.get('#cost-author-chart').innerHTML;
  assert.equal((chart.match(/<progress /g) || []).length, 1);
  assert.match(chart, /0,64/);
  assert.match(chart, /&lt;Autor A&gt;/);
  assert.doesNotMatch(chart, /<Autor A>/);
  const numberChart = elements.get('#cost-number-chart').innerHTML;
  assert.equal((numberChart.match(/<progress /g) || []).length, 2);
  assert.match(numberChart, /Principal/);
  assert.match(numberChart, /Comercial/);
  assert.equal((elements.get('#cost-author-detail').innerHTML.match(/<tbody><tr>|<\/tr><tr>/g) || []).length, 2);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { detectCsvDelimiter, parseCsv } = require('../src/services/campaign-csv-service');
const { normalizeRecipientPhone } = require('../src/services/bulk-send-rules');

test('downloadable bulk model matches the importer and contains no sendable sample phone',()=>{
  const text=fs.readFileSync('public/modelos/envio-em-massa.csv','utf8').replace(/^\uFEFF/,'');
  assert.equal(detectCsvDelimiter(text),';');
  const rows=parseCsv(text,detectCsvDelimiter(text));
  assert.deepEqual(rows[0],['Nome','Telefone']);
  assert.equal(rows.length,3);
  for(const row of rows.slice(1)) {
    assert.equal(row.length,2);assert(row[0]);
    assert.equal(row[1],'DDDNÚMERO');
    assert(!normalizeRecipientPhone(row[1]).phone, 'replace placeholders before sending');
  }
  assert(fs.readFileSync('public/js/whatsapp-send-wizard.js','utf8').includes('href="/modelos/envio-em-massa.csv"'));
});

test('bulk import recognizes name/phone headers and adds Brazil country code to local numbers',()=>{
  const text='Nome;Telefone\nMaria;11999998888\nJoão;(11) 3333-4444';
  const rows=parseCsv(text,detectCsvDelimiter(text));
  const name=rows[0].findIndex(h=>/nome|name/i.test(h));
  const phone=rows[0].findIndex(h=>/tel|fone|phone|celular|whats/i.test(h));
  assert.equal(rows[1][name],'Maria');
  assert.deepEqual(normalizeRecipientPhone(rows[1][phone]),{phone:'5511999998888'});
  assert.deepEqual(normalizeRecipientPhone(rows[2][phone]),{phone:'551133334444'});
});

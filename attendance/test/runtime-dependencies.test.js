const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const multer = require('multer');
const proxyaddr = require('proxy-addr');
const axios = require('axios');

test('proxy: sub-rede IPv4-mapped curta não confia em endereço público; rede legítima funciona', () => {
  assert.equal(proxyaddr.compile('::ffff:10.0.0.0/8')('203.0.113.9'), false);
  const valid = proxyaddr.compile('10.0.0.0/8');
  assert.equal(valid('10.1.2.3'), true);
  assert.equal(valid('203.0.113.9'), false);
});

test('multipart: campos malformados não derrubam servidor; upload legítimo permanece funcional', async () => {
  const app = express();
  app.post('/upload', multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024, fields: 10 } }).single('file'), (req, res) => res.json({ size: req.file?.size || 0 }));
  app.get('/health', (_req, res) => res.sendStatus(200));
  app.use((error, _req, res, _next) => res.status(400).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const fields of [[['a[]', 'x'], ['a[length]', 'invalid']], [['a[0]', 'x'], ['a[4294967295]', 'y']]]) {
      const body = new FormData();
      for (const [name, value] of fields) body.append(name, value);
      const response = await fetch(`${base}/upload`, { method: 'POST', body, signal: AbortSignal.timeout(2000) });
      assert.ok([200, 400].includes(response.status));
      assert.equal((await fetch(`${base}/health`)).status, 200);
    }
    const body = new FormData();
    body.append('file', new Blob(['hello']), 'ok.txt');
    const response = await fetch(`${base}/upload`, { method: 'POST', body });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).size, 5);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('axios: método herdado não muda o GET padrão; requisição legítima funciona', async () => {
  const app = express();
  app.use((req, res) => res.json({ method: req.method }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const original = Object.getOwnPropertyDescriptor(Object.prototype, 'method');
  try {
    Object.defineProperty(Object.prototype, 'method', { value: 'POST', configurable: true, writable: true });
    const response = await axios.request({ url: `http://127.0.0.1:${server.address().port}`, proxy: false });
    assert.equal(response.data.method, 'GET');
  } finally {
    if (original) Object.defineProperty(Object.prototype, 'method', original);
    else delete Object.prototype.method;
    await new Promise(resolve => server.close(resolve));
  }
});

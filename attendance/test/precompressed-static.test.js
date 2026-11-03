const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const express = require('express');
const { buildStaticAssets } = require('../scripts/build-static-assets');
const { precompressedStatic, preferredEncoding } = require('../src/middleware/precompressed-static');

test('encoding negotiation respects q=0, preferences, wildcard and missing header', () => {
  const variants = {br:'.br',gzip:'.gz'};
  assert.equal(preferredEncoding('',variants),null);
  assert.equal(preferredEncoding('br;q=0,gzip',variants),'gzip');
  assert.equal(preferredEncoding('br;q=0.5,gzip;q=1',variants),'gzip');
  assert.equal(preferredEncoding('br,gzip',variants),'br');
  assert.equal(preferredEncoding('*;q=0',variants),null);
  assert.equal(preferredEncoding('*;q=1,br;q=0',variants),'gzip');
});

test('build excludes protected HTML and service worker; HTTP preserves bytes, MIME, HEAD, ETag, ranges and fallback', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'central-static-perf-'));
  fs.mkdirSync(path.join(root,'js'));
  const source=Buffer.from('console.log("asset público");\n'.repeat(120));
  fs.writeFileSync(path.join(root,'js','app.js'),source);
  fs.writeFileSync(path.join(root,'service-worker.js'),source);
  fs.writeFileSync(path.join(root,'agenda.html'),source);
  const manifest=buildStaticAssets(root);
  assert.deepEqual(Object.keys(manifest),['/js/app.js']);
  // Docker COPY/layers can discard fractional timestamps without changing bytes.
  const timestamp=Math.floor(fs.statSync(path.join(root,'js','app.js')).mtimeMs/1000);
  fs.utimesSync(path.join(root,'js','app.js'),timestamp,timestamp);
  const app=express();
  app.get('/agenda.html',(_req,res)=>res.sendStatus(401));
  app.use(precompressedStatic(root));app.use(express.static(root));
  const server=app.listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  const request=(url,headers={},method='GET')=>new Promise((resolve,reject)=>{
    http.request({host:'127.0.0.1',port:server.address().port,path:url,headers,method},res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
    }).on('error',reject).end();
  });
  try {
    for(const encoding of ['br','gzip']) {
      const result=await request('/js/app.js?v=1',{'Accept-Encoding':encoding});
      assert.equal(result.status,200);assert.equal(result.headers['content-encoding'],encoding);
      assert.match(result.headers['content-type'],/javascript/);assert.match(result.headers.vary,/Accept-Encoding/);
      assert.deepEqual(encoding==='br'?zlib.brotliDecompressSync(result.body):zlib.gunzipSync(result.body),source);
      assert(result.body.length<source.length);
      const cached=await request('/js/app.js',{'Accept-Encoding':encoding,'If-None-Match':result.headers.etag});
      assert.equal(cached.status,304);
      const head=await request('/js/app.js',{'Accept-Encoding':encoding},'HEAD');
      assert.equal(head.body.length,0);assert.equal(Number(head.headers['content-length']),result.body.length);
    }
    const plain=await request('/js/app.js',{'Accept-Encoding':'br;q=0,gzip;q=0'});
    assert.deepEqual(plain.body,source);assert.equal(plain.headers['content-encoding'],undefined);
    const range=await request('/js/app.js',{'Accept-Encoding':'br',Range:'bytes=0-9'});
    assert.equal(range.status,206);assert.deepEqual(range.body,source.subarray(0,10));
    assert.equal((await request('/agenda.html',{'Accept-Encoding':'br'})).status,401);
    assert.equal((await request('/service-worker.js',{'Accept-Encoding':'br'})).headers['content-encoding'],undefined);
    // Changed development source before startup invalidates the manifest.
    fs.appendFileSync(path.join(root,'js','app.js'),'// changed');
    const middleware=precompressedStatic(root);let fellBack=false;
    middleware({method:'GET',path:'/js/app.js',headers:{}},{},()=>{fellBack=true});
    assert(fellBack);
  } finally {await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}
});

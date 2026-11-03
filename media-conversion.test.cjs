const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const vm = require('node:vm');
const {EventEmitter}=require('node:events');
const path = require('node:path');
const { conversionFormat, createConverter, run } = require('./attendance/src/services/media-conversion-service');
const bmp = Buffer.from('BMsynthetic');
const probe = Buffer.from(JSON.stringify({ streams: [{ codec_type: 'video', width: 16, height: 16 }], format: { duration: '1' } }));

test('conversion is selected by bytes, not extension or declared MIME', () => {
  assert.equal(conversionFormat(bmp, 'image'), 'bmp_pipe');
  assert.equal(conversionFormat(Buffer.from('RIFF0000WEBPVP8 '), 'image'), 'webp_pipe');
  assert.equal(conversionFormat(Buffer.from('RIFF0000WAVE'), 'audio'), 'wav');
  assert.equal(conversionFormat(Buffer.from('fLaC0000'), 'audio'), 'flac');
  assert.equal(conversionFormat(Buffer.from('GIF89a0000'), 'video'), 'gif');
  assert.equal(conversionFormat(Buffer.from('RIFF0000AVI '), 'video'), 'avi');
  assert.equal(conversionFormat(Buffer.from('0000ftypqt  '), 'video'), 'mov');
  assert.equal(conversionFormat(Buffer.from('0000ftypisom'), 'video'), null);
  assert.equal(conversionFormat(Buffer.from('not an image named.bmp'), 'image'), null);
});

test('native media bypasses expensive conversion', async () => {
  const convert = createConverter({ execute: () => { throw Error('must not execute'); } });
  const buffer = Buffer.from([255, 216, 255]);
  assert.equal((await convert({ kind: 'image', buffer, mimeType: 'image/jpeg', fileName: 'native.jpg' })).buffer, buffer);
});

test('conversion uses bounded output, removes temporary inputs and sanitizes output name', async () => {
  let input;
  const convert = createConverter({ execute: async (binary, args, limit) => {
    if (binary === 'ffprobe') { input = args.at(-1); assert.deepEqual(await fs.readFile(input), bmp); return probe; }
    assert.equal(limit, 5 * 1024 * 1024);
    assert.equal(args.at(-1), 'pipe:1');
    assert.ok(args.includes('file,pipe'));
    assert.ok(args.includes('bmp_pipe'));
    return Buffer.from('synthetic PNG output');
  } });
  const result = await convert({ kind: 'image', buffer: bmp, fileName: '../../test.bmp' });
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.fileName, 'test.png');
  await assert.rejects(fs.stat(input), { code: 'ENOENT' });
});

test('one conversion at a time without delaying native files; slot released after errors', async () => {
  let release, reached;
  const started = new Promise(resolve => { reached = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  const convert = createConverter({ execute: async () => { reached(); await wait; throw Error('synthetic failure'); } });
  const first = convert({ kind: 'image', buffer: bmp });
  await started;
  await assert.rejects(convert({ kind: 'image', buffer: bmp }), { statusCode: 429 });
  assert.equal((await convert({ kind: 'image', buffer: Buffer.from('native') })).buffer.toString(), 'native');
  release(); await assert.rejects(first, /synthetic failure/);
  await assert.rejects(convert({ kind: 'image', buffer: bmp }), /synthetic failure/);
});

test('oversized dimensions and excessive duration cannot start encoding', async () => {
  for (const data of [
    { kind: 'image', buffer: bmp, meta: { streams: [{ codec_type: 'video', width: 100000, height: 100000 }] } },
    { kind: 'video', buffer: Buffer.from('GIF89a000'), meta: { streams: [{ codec_type: 'video', width: 16, height: 16 }], format: { duration: 301 } } },
  ]) {
    let calls = 0;
    const convert = createConverter({ execute: async () => { calls++; return Buffer.from(JSON.stringify(data.meta)); } });
    await assert.rejects(convert(data), { statusCode: 400 }); assert.equal(calls, 1);
  }
});

test('animated WebP is routed to the animation converter', () => {
  const animated = Buffer.alloc(24); animated.write('RIFF'); animated.write('WEBP', 8); animated.write('VP8X', 12); animated[20] = 2;
  assert.equal(conversionFormat(animated,'image'),'webp-animation');
});

test('missing converter is a recoverable error', async () => {
  await assert.rejects(run('missing', [], 1024, () => { throw Error('ENOENT'); }), { statusCode: 503 });
});

test('converter subprocess receives no application credentials and Linux resource limits are enforced',async()=>{
 let captured;
 const spawnFake=(binary,args,options)=>{captured={binary,args,options};const child=new EventEmitter();child.stdout=new EventEmitter();child.kill=()=>{};setImmediate(()=>{child.stdout.emit('data',Buffer.from('ok'));child.emit('close',0);});return child;};
 await run('ffmpeg',['-version'],1024,spawnFake);
 assert.equal(captured.options.shell,false);
 for(const name of ['DATABASE_URL','AUTH_SECRET','SESSION_SECRET','CENTRAL_IDENTITY_SECRET','NODE_OPTIONS'])assert.equal(captured.options.env[name],undefined);
 if(process.platform==='linux'){assert.equal(captured.binary,'prlimit');assert.ok(captured.args.includes('--data=268435456'));assert.ok(captured.args.includes('--cpu=40'));}
});

test('permission and WhatsApp window checked before conversion; permission rechecked afterwards', async () => {
  const source = await fs.readFile(path.join(__dirname, 'attendance/src/controllers/inbox-controller.js'), 'utf8');
  const start = source.indexOf('async function prepareTeamAttachment('), end = source.indexOf('\nconst inbox =', start);
  assert.ok(start >= 0 && end > start);
  const events = [];
  const ctx = { authorization: { assertCanActOnConversation: async () => events.push('permission') }, prisma: { conversation: { findUnique: async () => ({ channel: 'META', channelAccountId: 'synthetic' }) } }, conversionFormat: () => 'bmp_pipe', convertOutgoingMedia: async () => { events.push('convert'); return { buffer: Buffer.from('output') }; }, require: () => ({ assertFreeFormAllowed: async () => events.push('window') }), Date, Error };
  vm.createContext(ctx); vm.runInContext(source.slice(start, end), ctx);
  const req = { params: { id: 'synthetic' }, user: { id: 'synthetic' }, file: { buffer: bmp } };
  await ctx.prepareTeamAttachment(req, 'image');
  assert.deepEqual(events, ['permission', 'window', 'convert', 'permission']);
  ctx.authorization.assertCanActOnConversation = async () => { throw Error('revoked'); };
  events.length = 0; await assert.rejects(ctx.prepareTeamAttachment(req, 'image'), /revoked/); assert.deepEqual(events, []);
  let checks = 0;
  ctx.authorization.assertCanActOnConversation = async () => { if (++checks === 2) throw Error('revoked during conversion'); };
  await assert.rejects(ctx.prepareTeamAttachment(req, 'image'), /revoked during conversion/);
});

test('switching chat while conversion sends to original conversation and preserves new draft', async () => {
  const source = await fs.readFile(path.join(__dirname, 'attendance/public/js/app.js'), 'utf8');
  const start = source.indexOf('$("#composer").addEventListener("submit",');
  const end = source.indexOf('$("#open-templates")', start);
  let handler, release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  const input = { value:'original caption', focus() {} }, button = {};
  const ctx = { state:{ selectedId:'original', pendingBotSuggestion:null }, selectedAttachment:{ type:'video/quicktime' }, pendingAudio:null, isAudioRecording:()=>false,
    $:id=>id === '#composer' ? { addEventListener:(_name, fn)=>{ handler=fn; } } : id === '#message-input' ? input : button,
    window:{}, isDocumentMime:()=>false, FormData:class { append() {} }, api:async url=>{ assert.equal(url,'/api/conversations/original/videos'); entered(); await wait; },
    clearSelectedAttachment:()=>{ throw Error('must not clear another conversation'); }, syncCustomerServiceWindow() {}, toast:message=>{ throw Error(message); } };
  vm.createContext(ctx); vm.runInContext(source.slice(start,end),ctx);
  const sending = handler({ preventDefault() {} }); await started;
  ctx.state.selectedId = 'different'; input.value = 'new draft'; ctx.selectedAttachment = { type:'image/png' };
  release(); await sending;
  assert.equal(input.value, 'new draft'); assert.equal(ctx.selectedAttachment.type, 'image/png');
});

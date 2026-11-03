// Executar somente no container candidato, sem rede/banco e com fixtures sintéticas.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const { createConverter } = require('./src/services/media-conversion-service');

test('real conversion of synthetic BMP, WebP, GIF, AVI, MOV, WAV and FLAC', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'central-fixture-'));
  const convert = createConverter();
  try {
    for (const [ext, kind, input, encode] of [
      ['bmp', 'image', ['-f','lavfi','-i','color=c=blue:s=32x32'], ['-frames:v','1','-c:v','bmp']],
      ['webp', 'image', ['-f','lavfi','-i','color=c=blue:s=32x32'], ['-frames:v','1','-c:v','libwebp']],
      ['gif', 'video', ['-f','lavfi','-i','testsrc=size=32x32:rate=5:duration=1'], []],
      ['avi', 'video', ['-f','lavfi','-i','testsrc=size=32x32:rate=5:duration=1'], ['-c:v','mpeg4']],
      ['mov', 'video', ['-f','lavfi','-i','testsrc=size=32x32:rate=5:duration=1'], ['-c:v','mpeg4']],
      ['wav', 'audio', ['-f','lavfi','-i','sine=frequency=440:duration=1'], ['-c:a','pcm_s16le']],
      ['flac', 'audio', ['-f','lavfi','-i','sine=frequency=440:duration=1'], ['-c:a','flac']],
    ]) {
      const original = path.join(folder, 'input.' + ext);
      await execute('ffmpeg', ['-v','error','-nostdin','-threads','1','-filter_threads','1',...input,...encode,'-threads','1',original], { timeout: 10000 });
      const buffer = await fs.readFile(original), started = performance.now();
      const result = await convert({ buffer, kind, fileName: 'input.' + ext });
      const ms = Math.round(performance.now() - started);
      assert.equal(result.mimeType, { image:'image/png', video:'video/mp4', audio:'audio/ogg' }[kind]);
      const output = path.join(folder, result.fileName);
      await fs.writeFile(output, result.buffer);
      const meta = JSON.parse((await execute('ffprobe', ['-v','error','-show_streams','-show_format','-of','json',output])).stdout);
      const stream = meta.streams.find(stream => stream.codec_type === (kind === 'image' ? 'video' : kind));
      assert.equal(stream.codec_name, { image:'png', video:'h264', audio:'opus' }[kind]);
      if (kind !== 'image') assert.ok(Number(meta.format.duration) >= .9, 'must not truncate animation/audio/video');
      if (kind === 'image') { assert.equal(stream.width, 32); assert.equal(stream.height, 32); }
      console.log(JSON.stringify({ fixture:ext, inputBytes:buffer.length, outputBytes:result.buffer.length, conversionMs:ms }));
    }
  } finally { await fs.rm(folder, { recursive:true, force:true }); }
});

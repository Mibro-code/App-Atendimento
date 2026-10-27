// Offline compression only: no runtime CPU cost and no new dependency.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { createHash } = require('node:crypto');

function buildStaticAssets(root = path.resolve('public')) {
  const manifest = {};
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { visit(file); continue; }
      if (!entry.isFile() || !/\.(?:js|css|svg|webmanifest)$/.test(entry.name) || file === path.join(root, 'service-worker.js')) continue;
      const source = fs.readFileSync(file);
      if (source.length < 1024) continue;
      const variants = {};
      for (const [encoding, extension, data] of [
        ['br', '.br', zlib.brotliCompressSync(source, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } })],
        ['gzip', '.gz', zlib.gzipSync(source, { level: 9 })],
      ]) {
        if (data.length >= source.length) continue;
        fs.writeFileSync(file + extension, data);
        variants[encoding] = extension;
      }
      if (Object.keys(variants).length) manifest['/' + path.relative(root, file).split(path.sep).join('/')] = {
        bytes: source.length, sha256: createHash('sha256').update(source).digest('hex'), variants,
      };
    }
  }
  visit(root);
  fs.writeFileSync(path.join(root, '.compressed-assets.json'), JSON.stringify(manifest));
  return manifest;
}

if (require.main === module) console.log(`Precompressed ${Object.keys(buildStaticAssets()).length} public assets`);
module.exports = { buildStaticAssets };

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

function preferredEncoding(header, variants) {
  if (!header) return null;
  const qualities = new Map(String(header).toLowerCase().split(',').map(part => {
    const [name, ...parameters] = part.trim().split(';');
    const q = parameters.find(p => p.trim().startsWith('q='));
    const value = q ? Number(q.trim().slice(2)) : 1;
    return [name, Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0];
  }));
  return ['br', 'gzip'].filter(e => variants[e] && (qualities.get(e) ?? qualities.get('*') ?? 0) > 0)
    .sort((a, b) => (qualities.get(b) ?? qualities.get('*') ?? 0) - (qualities.get(a) ?? qualities.get('*') ?? 0))[0] || null;
}

function precompressedStatic(root = path.resolve('public')) {
  const assets = new Map();
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(root, '.compressed-assets.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return (_req, _res, next) => next(); throw error; }
  // Validate once at startup. Unbuilt or changed development files fall back to express.static.
  for (const [url, entry] of Object.entries(manifest)) {
    if (!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:js|css|svg|webmanifest)$/.test(url) || url === '/service-worker.js') continue;
    const source = path.join(root, url.slice(1));
    try {
      const stat = fs.statSync(source);
      // Docker layers can round timestamps; validate actual content instead.
      if (stat.size !== entry.bytes || createHash('sha256').update(fs.readFileSync(source)).digest('hex') !== entry.sha256) continue;
      const variants = {};
      for (const [encoding, extension] of [['br', '.br'], ['gzip', '.gz']]) {
        if (entry.variants?.[encoding] === extension && fs.statSync(source + extension).isFile()) variants[encoding] = extension;
      }
      assets.set(url, { source, variants });
    } catch { /* Missing source or variant: normal static middleware still works. */ }
  }
  return (req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) return next();
    const asset = assets.get(req.path);
    if (!asset) return next();
    res.vary('Accept-Encoding');
    if (req.headers.range) return next();
    const encoding = preferredEncoding(req.headers['accept-encoding'], asset.variants);
    if (!encoding) return next();
    res.type(path.extname(asset.source));
    res.set('Content-Encoding', encoding);
    return res.sendFile(asset.source + asset.variants[encoding], { maxAge: 0 }, error => {
      if (error) next(error);
    });
  };
}

module.exports = { precompressedStatic, preferredEncoding };

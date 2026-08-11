const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const imageExtensions = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
]);

function validateImage({ buffer, mimeType }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw Object.assign(new Error("A imagem está vazia."), { statusCode: 400 });
  }
  if (buffer.length > MAX_IMAGE_SIZE) {
    throw Object.assign(new Error("A imagem deve ter no máximo 5 MB."), { statusCode: 413 });
  }
  if (!imageExtensions.has(mimeType)) {
    throw Object.assign(new Error("Envie uma imagem JPG ou PNG."), { statusCode: 400 });
  }
  const validJpeg = mimeType === "image/jpeg" && buffer.length >= 3
    && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const validPng = mimeType === "image/png" && buffer.length >= pngSignature.length
    && buffer.subarray(0, pngSignature.length).equals(pngSignature);
  if (!validJpeg && !validPng) {
    throw Object.assign(new Error("O arquivo não contém uma imagem JPG ou PNG válida."), { statusCode: 400 });
  }
}

function storageRoot() {
  return path.resolve(process.env.MEDIA_STORAGE_DIR || path.join(process.cwd(), "storage", "media"));
}

function safeFileName(value, mimeType) {
  const fallback = `imagem${imageExtensions.get(mimeType)}`;
  const name = path.basename(typeof value === "string" ? value : fallback)
    .replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120);
  return name || fallback;
}

async function storeImage({ buffer, mimeType, fileName, stableId }) {
  validateImage({ buffer, mimeType });
  const extension = imageExtensions.get(mimeType);
  const identity = stableId
    ? crypto.createHash("sha256").update(String(stableId)).digest("hex")
    : crypto.randomUUID().replaceAll("-", "");
  const storageKey = `${identity}${extension}`;
  await fs.mkdir(storageRoot(), { recursive: true });
  await fs.writeFile(path.join(storageRoot(), storageKey), buffer);
  return { storageKey, mimeType, fileName: safeFileName(fileName, mimeType), size: buffer.length };
}

function resolveImage(storageKey) {
  if (!/^[a-f0-9]{32,64}\.(jpg|png)$/.test(storageKey || "")) {
    throw Object.assign(new Error("Imagem inválida."), { statusCode: 404 });
  }
  return path.join(storageRoot(), storageKey);
}

async function removeImage(storageKey) {
  try { await fs.unlink(resolveImage(storageKey)); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}

module.exports = { MAX_IMAGE_SIZE, removeImage, resolveImage, storeImage, validateImage };

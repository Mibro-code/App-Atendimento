const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_AUDIO_SIZE = 16 * 1024 * 1024;
const mediaExtensions = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["audio/aac", ".aac"],
  ["audio/mp4", ".m4a"],
  ["audio/mpeg", ".mp3"],
  ["audio/amr", ".amr"],
  ["audio/ogg", ".ogg"],
]);

function normalizeMimeType(value) {
  return String(value || "").split(";", 1)[0].trim().toLowerCase();
}

function validateImage({ buffer, mimeType }) {
  mimeType = normalizeMimeType(mimeType);
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw Object.assign(new Error("A imagem está vazia."), { statusCode: 400 });
  }
  if (buffer.length > MAX_IMAGE_SIZE) {
    throw Object.assign(new Error("A imagem deve ter no máximo 5 MB."), { statusCode: 413 });
  }
  if (!["image/jpeg", "image/png"].includes(mimeType)) {
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

function validateAudio({ buffer, mimeType }) {
  mimeType = normalizeMimeType(mimeType);
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw Object.assign(new Error("O áudio está vazio."), { statusCode: 400 });
  }
  if (buffer.length > MAX_AUDIO_SIZE) {
    throw Object.assign(new Error("O áudio deve ter no máximo 16 MB."), { statusCode: 413 });
  }
  if (!mediaExtensions.has(mimeType) || !mimeType.startsWith("audio/")) {
    throw Object.assign(new Error("Formato de áudio não suportado."), { statusCode: 400 });
  }
}

function storageRoot() {
  return path.resolve(process.env.MEDIA_STORAGE_DIR || path.join(process.cwd(), "storage", "media"));
}

function safeFileName(value, mimeType) {
  const fallback = `${mimeType.startsWith("audio/") ? "audio" : "imagem"}${mediaExtensions.get(mimeType)}`;
  const name = path.basename(typeof value === "string" ? value : fallback)
    .replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120);
  return name || fallback;
}

async function storeMedia({ buffer, mimeType, fileName, stableId, kind }) {
  mimeType = normalizeMimeType(mimeType);
  if (kind === "audio") validateAudio({ buffer, mimeType });
  else validateImage({ buffer, mimeType });
  const extension = mediaExtensions.get(mimeType);
  const identity = stableId
    ? crypto.createHash("sha256").update(String(stableId)).digest("hex")
    : crypto.randomUUID().replaceAll("-", "");
  const storageKey = `${identity}${extension}`;
  await fs.mkdir(storageRoot(), { recursive: true });
  await fs.writeFile(path.join(storageRoot(), storageKey), buffer);
  return { storageKey, mimeType, fileName: safeFileName(fileName, mimeType), size: buffer.length };
}

async function storeImage(options) {
  return storeMedia({ ...options, kind: "image" });
}

async function storeAudio(options) {
  return storeMedia({ ...options, kind: "audio" });
}

function resolveMedia(storageKey) {
  if (!/^[a-f0-9]{32,64}\.(jpg|png|aac|m4a|mp3|amr|ogg)$/.test(storageKey || "")) {
    throw Object.assign(new Error("Mídia inválida."), { statusCode: 404 });
  }
  return path.join(storageRoot(), storageKey);
}

const resolveImage = resolveMedia;

async function removeImage(storageKey) {
  try { await fs.unlink(resolveMedia(storageKey)); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}

module.exports = {
  MAX_AUDIO_SIZE, MAX_IMAGE_SIZE, normalizeMimeType, removeImage, resolveImage, resolveMedia,
  storeAudio, storeImage, validateAudio, validateImage,
};

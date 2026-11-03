import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const HASH_VERSION = "v1";
const KEY_LENGTH = 64;

export function validateWholesalePassword(password) {
  if (typeof password !== "string" || password.length < 12) {
    throw new Error("A senha temporaria precisa ter pelo menos 12 caracteres.");
  }

  if (password.length > 128) {
    throw new Error("A senha temporaria e muito longa.");
  }

  return password;
}

export function generateTemporaryPassword() {
  return `MBR-${randomBytes(12).toString("base64url")}-9a`;
}

export async function hashWholesalePassword(password) {
  validateWholesalePassword(password);
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, KEY_LENGTH);

  return [
    "scrypt",
    HASH_VERSION,
    salt.toString("base64url"),
    Buffer.from(derivedKey).toString("base64url"),
  ].join("$");
}

export async function verifyWholesalePassword(password, storedHash) {
  if (typeof password !== "string" || typeof storedHash !== "string") {
    return false;
  }

  const [algorithm, version, encodedSalt, encodedHash] = storedHash.split("$");
  if (
    algorithm !== "scrypt" ||
    version !== HASH_VERSION ||
    !encodedSalt ||
    !encodedHash
  ) {
    return false;
  }

  try {
    const expected = Buffer.from(encodedHash, "base64url");
    const actual = Buffer.from(
      await scrypt(
        password,
        Buffer.from(encodedSalt, "base64url"),
        expected.length,
      ),
    );

    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

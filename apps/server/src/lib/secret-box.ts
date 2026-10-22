import crypto from "node:crypto";
import { env } from "./env.js";

// Secrets VideoCAT has to use again later (the secret key of an S3 bucket) are sealed with
// AES-256-GCM under STORAGE_SECRET_KEY. The context (the bucket id) is authenticated too, so a
// sealed value copied onto another row does not open.

const version = "v1";

export type StorageKeyState = "ready" | "missing" | "invalid";

export function storageKeyState(): StorageKeyState {
  if (!env.STORAGE_SECRET_KEY) return "missing";
  return /^[0-9a-fA-F]{64}$/.test(env.STORAGE_SECRET_KEY) ? "ready" : "invalid";
}

export function storageSecretKey(): Buffer | null {
  return storageKeyState() === "ready" ? Buffer.from(env.STORAGE_SECRET_KEY!, "hex") : null;
}

if (storageKeyState() === "invalid") {
  console.warn("STORAGE_SECRET_KEY is not 64 hexadecimal characters (openssl rand -hex 32): S3 buckets cannot be added until it is fixed.");
}

export function sealSecret(plain: string, context: string, key: Buffer | null = storageSecretKey()): string {
  if (!key) throw Object.assign(new Error("STORAGE_SECRET_KEY is not configured"), { statusCode: 409 });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const sealed = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [version, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), sealed.toString("base64url")].join(".");
}

export function openSecret(sealed: string, context: string, key: Buffer | null = storageSecretKey()): string {
  if (!key) throw Object.assign(new Error("STORAGE_SECRET_KEY is not configured"), { statusCode: 409 });
  const [tag, iv, authTag, data] = sealed.split(".");
  if (tag !== version || !iv || !authTag || !data) throw new Error("Unknown sealed secret format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(authTag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

// What the web shows of a secret: its last characters, never the value.
export function secretHint(plain: string): string {
  return plain.length > 8 ? plain.slice(-4) : "";
}

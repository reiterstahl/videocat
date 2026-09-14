import crypto from "node:crypto";
import { env } from "./env.js";

const pairingAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function normalizePairingCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function generatePairingCode(length = 10): string {
  return Array.from({ length }, () => pairingAlphabet[crypto.randomInt(pairingAlphabet.length)]).join("");
}

export function displayPairingCode(code: string): string {
  const normalized = normalizePairingCode(code);
  return `${normalized.slice(0, 5)}-${normalized.slice(5)}`;
}

export function generateAgentCredential(): string {
  return `vcat_agent_${crypto.randomBytes(32).toString("base64url")}`;
}

export function hashAgentSecret(value: string): string {
  return crypto.createHmac("sha256", env.JWT_SECRET).update(value).digest("hex");
}

export function constantTimeHashEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

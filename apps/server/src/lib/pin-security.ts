import crypto from "node:crypto";

const hashIterations = 120_000;

function constantTimeHexEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a, "hex");
  const bBuffer = Buffer.from(b, "hex");
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

export function constantTimeStringEqual(a: string, b: string): boolean {
  const aHash = crypto.createHash("sha256").update(a).digest();
  const bHash = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(aHash, bHash);
}

export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(pin, salt, hashIterations, 32, "sha256").toString("hex");
  return `pbkdf2-sha256$${hashIterations}$${salt}$${hash}`;
}

export function verifyHashedPin(pin: string, storedHash: string): boolean {
  const [algorithm, iterationText, salt, expected, extra] = storedHash.split("$");
  const iterations = Number(iterationText);
  if (
    extra !== undefined
    || algorithm !== "pbkdf2-sha256"
    || !Number.isInteger(iterations)
    || iterations < 100_000
    || iterations > 1_000_000
    || !/^[a-f0-9]{32}$/i.test(salt ?? "")
    || !/^[a-f0-9]{64}$/i.test(expected ?? "")
  ) return false;
  const actual = crypto.pbkdf2Sync(pin, salt, iterations, 32, "sha256").toString("hex");
  return constantTimeHexEqual(actual, expected);
}

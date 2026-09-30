import crypto from "node:crypto";

export const minimumCompanionTokenLength = 16;

export function generateCompanionToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

function presentedToken(headers: Record<string, string | string[] | undefined>): string | null {
  const headerToken = headers["x-videocat-companion-token"];
  if (typeof headerToken === "string" && headerToken) return headerToken;
  const authorization = headers.authorization;
  if (typeof authorization === "string") {
    const bearer = authorization.replace(/^Bearer\s+/i, "");
    if (bearer && bearer !== authorization) return bearer;
  }
  return null;
}

// Every local action needs the per-installation token. Without a configured token nothing is authorized.
export function isLocalRequestAuthorized(
  expectedToken: string | undefined,
  headers: Record<string, string | string[] | undefined>
): boolean {
  const expected = expectedToken?.trim();
  if (!expected || expected.length < minimumCompanionTokenLength) return false;
  const token = presentedToken(headers);
  if (!token) return false;
  return crypto.timingSafeEqual(
    crypto.createHash("sha256").update(token).digest(),
    crypto.createHash("sha256").update(expected).digest()
  );
}

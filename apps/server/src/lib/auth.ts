import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { env } from "./env.js";
import { prisma } from "./prisma.js";
import { clearRateLimit, rateLimit } from "./security.js";

const cookieName = "videocat_session";
const protectedFolderCookieName = "videocat_protected_folder";
const jwtIssuer = "videocat";
const webAudience = "videocat-web";
const protectedAudience = "videocat-protected-folder";
const companionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function constantTimeEqual(a: string, b: string): boolean {
  const aBuffer = crypto.createHash("sha256").update(a).digest();
  const bBuffer = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function clientKey(request: FastifyRequest, scope: string): string {
  return `${scope}:${request.ip}`;
}

function verifyJwt(token: string, audience: string): JwtPayload {
  const payload = jwt.verify(token, env.JWT_SECRET, {
    issuer: jwtIssuer,
    audience,
    algorithms: ["HS256"]
  });
  if (typeof payload === "string") throw new Error("Invalid token payload");
  return payload;
}

export function isValidAdminLogin(username: string, password: string): boolean {
  return constantTimeEqual(username, env.ADMIN_USER) && constantTimeEqual(password, env.ADMIN_PASSWORD);
}

export function signSession(username: string): string {
  return jwt.sign({ role: "admin" }, env.JWT_SECRET, {
    subject: username,
    issuer: jwtIssuer,
    audience: webAudience,
    algorithm: "HS256",
    expiresIn: "12h"
  });
}

export function isValidProtectedFolderPin(pin: string): boolean {
  return constantTimeEqual(pin, env.PROTECTED_FOLDER_PIN);
}

export function signProtectedFolderUnlock(): string {
  return jwt.sign({ scope: "protected-folder" }, env.JWT_SECRET, {
    issuer: jwtIssuer,
    audience: protectedAudience,
    algorithm: "HS256",
    expiresIn: "12h"
  });
}

export function isProtectedFolderUnlocked(request: FastifyRequest): boolean {
  const token = request.cookies[protectedFolderCookieName];
  if (!token) return false;

  try {
    const payload = verifyJwt(token, protectedAudience);
    return payload.scope === "protected-folder";
  } catch {
    return false;
  }
}

export async function requireWebAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.cookies[cookieName] ?? request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) {
    await reply.code(401).send({ message: "Authentication required" });
    return;
  }

  try {
    const payload = verifyJwt(token, webAudience);
    if (payload.role !== "admin" || payload.sub !== env.ADMIN_USER) throw new Error("Invalid session payload");
  } catch {
    await reply.code(401).send({ message: "Invalid session" });
  }
}

export async function requireAgentAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const limitKey = clientKey(request, "agent-auth");
  const current = rateLimit(limitKey, 60, 60 * 1000);
  if (!current.allowed) {
    await reply
      .code(429)
      .header("Retry-After", String(current.retryAfterSeconds))
      .send({ message: "Too many agent authentication attempts" });
    return;
  }

  const header = request.headers.authorization;
  const token = header?.replace(/^Bearer\s+/i, "") ?? "";
  if (!constantTimeEqual(token, env.AGENT_TOKEN)) {
    await reply.code(401).send({ message: "Invalid agent token" });
    return;
  }

  const headerValue = request.headers["x-videocat-companion-id"];
  const companionId = typeof headerValue === "string" ? headerValue : undefined;
  if (companionId && !companionIdPattern.test(companionId)) {
    await reply.code(400).send({ message: "Invalid companion identity" });
    return;
  }

  if (companionId) {
    const companion = await prisma.companionAgent.findUnique({
      where: { installationId: companionId },
      select: { revokedAt: true }
    });
    if (companion?.revokedAt) {
      await reply.code(403).send({ message: "Companion identity revoked" });
      return;
    }
  }

  clearRateLimit(limitKey);
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.COOKIE_SECURE ?? process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12
  });
}

export function setProtectedFolderCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(protectedFolderCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.COOKIE_SECURE ?? process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(cookieName, { path: "/" });
  reply.clearCookie(protectedFolderCookieName, { path: "/" });
}

export function clearProtectedFolderCookie(reply: FastifyReply): void {
  reply.clearCookie(protectedFolderCookieName, { path: "/" });
}

export async function enforceLoginRateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const current = rateLimit(clientKey(request, "login"), 8, 15 * 60 * 1000);
  if (!current.allowed) {
    await reply
      .code(429)
      .header("Retry-After", String(current.retryAfterSeconds))
      .send({ message: "Too many login attempts. Try again later." });
  }
}

export function clearLoginRateLimit(request: FastifyRequest): void {
  clearRateLimit(clientKey(request, "login"));
}

export async function enforceProtectedPinRateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const current = rateLimit(clientKey(request, "protected-pin"), 6, 15 * 60 * 1000);
  if (!current.allowed) {
    await reply
      .code(429)
      .header("Retry-After", String(current.retryAfterSeconds))
      .send({ message: "Too many PIN attempts. Try again later." });
  }
}

export function clearProtectedPinRateLimit(request: FastifyRequest): void {
  clearRateLimit(clientKey(request, "protected-pin"));
}

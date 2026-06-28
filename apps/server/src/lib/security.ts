import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "./env.js";

const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type RateBucket = {
  count: number;
  resetAt: number;
};

const rateBuckets = new Map<string, RateBucket>();

export function applySecurityHeaders(_request: FastifyRequest, reply: FastifyReply, done: () => void): void {
  reply.header("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' http://127.0.0.1:29429 http://localhost:29429",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'"
  ].join("; "));
  reply.header("Cross-Origin-Resource-Policy", "same-origin");
  reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  reply.header("Referrer-Policy", "no-referrer");
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  done();
}

function requestOrigin(request: FastifyRequest): string | null {
  const origin = request.headers.origin;
  if (typeof origin === "string" && origin) return origin;

  const referer = request.headers.referer;
  if (typeof referer !== "string" || !referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function configuredOrigins(): Set<string> {
  return new Set(env.WEB_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean));
}

function forwardedOrigin(request: FastifyRequest): string | null {
  const host = request.headers["x-forwarded-host"] ?? request.headers.host;
  if (typeof host !== "string" || !host) return null;
  const proto = request.headers["x-forwarded-proto"];
  const scheme = typeof proto === "string" && proto ? proto.split(",")[0] : request.protocol;
  return `${scheme}://${host}`;
}

export async function requireTrustedOrigin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.url.startsWith("/api/")) return;
  if (!stateChangingMethods.has(request.method)) return;
  if (request.url.startsWith("/api/agent/")) return;

  const origin = requestOrigin(request);
  if (!origin) return;

  const allowedOrigins = configuredOrigins();
  const sameOrigin = forwardedOrigin(request);
  if (allowedOrigins.has(origin) || origin === sameOrigin) return;

  await reply.code(403).send({ message: "Untrusted request origin" });
}

export function rateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const existing = rateBuckets.get(key);
  const bucket = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + windowMs };
  bucket.count += 1;
  rateBuckets.set(key, bucket);

  return {
    allowed: bucket.count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
  };
}

export function clearRateLimit(key: string): void {
  rateBuckets.delete(key);
}

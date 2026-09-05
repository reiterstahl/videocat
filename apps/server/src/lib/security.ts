import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "./env.js";

const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type RateBucket = {
  count: number;
  resetAt: number;
};

const rateBuckets = new Map<string, RateBucket>();
const maxRateBuckets = 10_000;
let rateLimitCalls = 0;

export function applySecurityHeaders(_request: FastifyRequest, reply: FastifyReply, done: () => void): void {
  reply.header("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' http://127.0.0.1:29429 http://localhost:29429 http://127.0.0.1:18431 http://localhost:18431 http://127.0.0.1:23447 http://localhost:23447 http://127.0.0.1:31469 http://localhost:31469 http://127.0.0.1:37483 http://localhost:37483 http://127.0.0.1:43517 http://localhost:43517 http://127.0.0.1:49627 http://localhost:49627 http://127.0.0.1:55733 http://localhost:55733 http://127.0.0.1:60149 http://localhost:60149 http://127.0.0.1:15319 http://localhost:15319 http://127.0.0.1:26891 http://localhost:26891",
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
  if (_request.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
  if (_request.protocol === "https") {
    reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
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

export async function requireTrustedOrigin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.url.startsWith("/api/")) return;
  if (!stateChangingMethods.has(request.method)) return;
  if (request.url.startsWith("/api/agent/")) return;

  const origin = requestOrigin(request);
  if (!origin) {
    const cookie = request.headers.cookie ?? "";
    if (cookie.includes("videocat_session=")) {
      await reply.code(403).send({ message: "Missing request origin" });
    }
    return;
  }

  const allowedOrigins = configuredOrigins();
  if (allowedOrigins.has(origin)) return;

  await reply.code(403).send({ message: "Untrusted request origin" });
}

function pruneRateBuckets(now: number): void {
  for (const [key, bucket] of rateBuckets) {
    if (bucket.resetAt <= now) rateBuckets.delete(key);
  }

  while (rateBuckets.size >= maxRateBuckets) {
    const oldestKey = rateBuckets.keys().next().value as string | undefined;
    if (!oldestKey) break;
    rateBuckets.delete(oldestKey);
  }
}

export function rateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  rateLimitCalls += 1;
  if (rateBuckets.size >= maxRateBuckets || rateLimitCalls % 256 === 0) pruneRateBuckets(now);
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

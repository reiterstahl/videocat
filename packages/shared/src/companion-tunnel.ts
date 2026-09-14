import { z } from "zod";

export const companionTunnelProtocolVersion = 1;
export const companionTunnelMaxMessageBytes = 16 * 1024;
export const companionStreamMaxRangeBytes = 512 * 1024;
export const companionStreamRequestTimeoutMs = 15_000;
export const companionStreamSessionLifetimeMs = 15 * 60 * 1000;
export const companionTunnelHandshakeTimeoutMs = 8_000;
export const companionTunnelPingIntervalMs = 20_000;
export const companionTunnelReconnectMaxMs = 60_000;

export const companionTunnelCapabilitiesSchema = z.object({
  control: z.literal(true),
  streamRead: z.boolean(),
  streamRemux: z.boolean().default(false)
});

export const companionTunnelHelloSchema = z.object({
  type: z.literal("tunnel.hello"),
  protocolVersion: z.literal(companionTunnelProtocolVersion),
  companionId: z.string().uuid(),
  credential: z.string().min(20).max(256),
  companionName: z.string().trim().min(1).max(120).optional(),
  version: z.number().int().nonnegative(),
  capabilities: companionTunnelCapabilitiesSchema
});

export const companionTunnelReadySchema = z.object({
  type: z.literal("tunnel.ready"),
  protocolVersion: z.literal(companionTunnelProtocolVersion),
  companionId: z.string().uuid(),
  capabilities: companionTunnelCapabilitiesSchema
});

export const companionTunnelErrorSchema = z.object({
  type: z.literal("tunnel.error"),
  code: z.enum([
    "authentication_failed",
    "credential_revoked",
    "protocol_error",
    "unsupported_message"
  ])
});

const tunnelRequestFields = {
  requestId: z.string().uuid(),
  sessionId: z.string().uuid()
};

export const companionStreamOpenSchema = z.object({
  type: z.literal("stream.open"),
  ...tunnelRequestFields,
  fileId: z.string().uuid(),
  diskId: z.string().uuid(),
  relativePath: z.string().trim().min(1).max(2000),
  expectedSizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  mode: z.enum(["original", "remux"]).default("original"),
  expiresAt: z.string().datetime()
});

export const companionStreamReadySchema = z.object({
  type: z.literal("stream.ready"),
  ...tunnelRequestFields,
  sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  mimeType: z.string().trim().min(1).max(120)
});

export const companionStreamRangeSchema = z.object({
  type: z.literal("stream.range"),
  ...tunnelRequestFields,
  offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  length: z.number().int().positive().max(companionStreamMaxRangeBytes)
});

export const companionStreamChunkSchema = z.object({
  type: z.literal("stream.chunk"),
  ...tunnelRequestFields,
  sequence: z.literal(0),
  bytes: z.number().int().positive().max(companionStreamMaxRangeBytes),
  eof: z.boolean()
});

export const companionStreamCancelSchema = z.object({
  type: z.literal("stream.cancel"),
  requestId: z.string().uuid().optional(),
  sessionId: z.string().uuid(),
  reason: z.enum(["client_closed", "expired", "superseded", "error"]).optional()
});

export const companionStreamErrorSchema = z.object({
  type: z.literal("stream.error"),
  ...tunnelRequestFields,
  code: z.enum(["not_found", "not_available", "unsafe_path", "expired", "read_failed", "invalid_range"])
});

export type CompanionTunnelCapabilities = z.infer<typeof companionTunnelCapabilitiesSchema>;
export type CompanionTunnelHello = z.infer<typeof companionTunnelHelloSchema>;
export type CompanionTunnelReady = z.infer<typeof companionTunnelReadySchema>;
export type CompanionTunnelError = z.infer<typeof companionTunnelErrorSchema>;
export type CompanionStreamOpen = z.infer<typeof companionStreamOpenSchema>;
export type CompanionStreamReady = z.infer<typeof companionStreamReadySchema>;
export type CompanionStreamRange = z.infer<typeof companionStreamRangeSchema>;
export type CompanionStreamChunk = z.infer<typeof companionStreamChunkSchema>;
export type CompanionStreamCancel = z.infer<typeof companionStreamCancelSchema>;
export type CompanionStreamError = z.infer<typeof companionStreamErrorSchema>;

export function companionTunnelUrl(serverUrl: string): string {
  const url = new URL("/api/agent/tunnel", serverUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function companionTunnelReconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const normalizedAttempt = Math.max(1, Math.floor(attempt));
  const exponential = Math.min(
    companionTunnelReconnectMaxMs,
    1_000 * 2 ** Math.min(normalizedAttempt - 1, 6)
  );
  return Math.min(companionTunnelReconnectMaxMs, exponential + Math.floor(random() * 500));
}

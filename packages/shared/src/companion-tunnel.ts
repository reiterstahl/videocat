import { z } from "zod";

export const companionTunnelProtocolVersion = 1;
export const companionTunnelMaxMessageBytes = 16 * 1024;
export const companionTunnelHandshakeTimeoutMs = 8_000;
export const companionTunnelPingIntervalMs = 20_000;
export const companionTunnelReconnectMaxMs = 60_000;

export const companionTunnelCapabilitiesSchema = z.object({
  control: z.literal(true),
  streamRead: z.literal(false)
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

export type CompanionTunnelCapabilities = z.infer<typeof companionTunnelCapabilitiesSchema>;
export type CompanionTunnelHello = z.infer<typeof companionTunnelHelloSchema>;
export type CompanionTunnelReady = z.infer<typeof companionTunnelReadySchema>;
export type CompanionTunnelError = z.infer<typeof companionTunnelErrorSchema>;

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

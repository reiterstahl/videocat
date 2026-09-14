import type { FastifyInstance } from "fastify";
import type { IncomingMessage } from "node:http";
import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import {
  companionTunnelHandshakeTimeoutMs,
  companionTunnelHelloSchema,
  companionTunnelMaxMessageBytes,
  companionTunnelPingIntervalMs,
  companionTunnelProtocolVersion,
  companionStreamChunkSchema,
  companionStreamErrorSchema,
  companionStreamMaxRangeBytes,
  companionStreamOpenSchema,
  companionStreamRangeSchema,
  companionStreamReadySchema,
  companionStreamRequestTimeoutMs,
  type CompanionTunnelCapabilities
} from "@videocat/shared";
import { verifyAgentCredentials } from "./auth.js";
import { prisma } from "./prisma.js";
import { clearRateLimit, rateLimit } from "./security.js";

type TunnelConnection = {
  socket: WebSocket;
  connectedAt: number;
  lastSeenAt: number;
  awaitingPong: boolean;
  capabilities: CompanionTunnelCapabilities;
};

type StreamOpenResult = { sizeBytes: number; mimeType: string };
type PendingOpen = { companionId: string; sessionId: string; resolve: (value: StreamOpenResult) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout };
type PendingRange = { companionId: string; sessionId: string; resolve: (value: Buffer) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout; expectedBytes?: number };

export type CompanionTunnelStatus = {
  connected: boolean;
  connectedAt: string | null;
  lastSeenAt: string | null;
  protocolVersion: number | null;
  capabilities: CompanionTunnelCapabilities | null;
};

const tunnelPath = "/api/agent/tunnel";
const registries = new WeakMap<object, CompanionControlTunnelRegistry>();

function rawMessageText(data: RawData): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return Buffer.concat(data).toString("utf8");
}

function send(socket: WebSocket, message: object): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function errorCode(statusCode: number): "authentication_failed" | "credential_revoked" {
  return statusCode === 403 ? "credential_revoked" : "authentication_failed";
}

class CompanionControlTunnelRegistry {
  private readonly connections = new Map<string, TunnelConnection>();
  private readonly pendingOpens = new Map<string, PendingOpen>();
  private readonly pendingRanges = new Map<string, PendingRange>();
  private readonly activeRangeByCompanion = new Map<string, string>();
  private readonly server = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    perMessageDeflate: false,
    maxPayload: companionStreamMaxRangeBytes + 1024
  });
  private readonly pingTimer: NodeJS.Timeout;

  constructor(private readonly app: FastifyInstance) {
    this.app.server.on("upgrade", (request, socket, head) => {
      const pathname = new URL(request.url ?? "/", "http://videocat.invalid").pathname;
      if (pathname !== tunnelPath) {
        socket.destroy();
        return;
      }
      this.server.handleUpgrade(request, socket, head, (webSocket) => {
        this.server.emit("connection", webSocket, request);
      });
    });
    this.server.on("connection", (socket, request) => this.accept(socket, request));
    this.pingTimer = setInterval(() => this.pingConnections(), companionTunnelPingIntervalMs);
    this.pingTimer.unref();
  }

  status(companionId: string): CompanionTunnelStatus {
    const connection = this.connections.get(companionId);
    if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
      return { connected: false, connectedAt: null, lastSeenAt: null, protocolVersion: null, capabilities: null };
    }
    return {
      connected: true,
      connectedAt: new Date(connection.connectedAt).toISOString(),
      lastSeenAt: new Date(connection.lastSeenAt).toISOString(),
      protocolVersion: companionTunnelProtocolVersion,
      capabilities: connection.capabilities
    };
  }

  disconnect(companionId: string, reason = "credential revoked"): void {
    const connection = this.connections.get(companionId);
    if (!connection) return;
    this.connections.delete(companionId);
    this.rejectForCompanion(companionId, new Error("Companion tunnel disconnected"));
    connection.socket.close(4003, reason);
  }

  async openStream(input: {
    companionId: string;
    sessionId: string;
    fileId: string;
    diskId: string;
    relativePath: string;
    expectedSizeBytes: number;
    mode: "original" | "remux";
    expiresAt: string;
  }): Promise<StreamOpenResult> {
    const connection = this.connections.get(input.companionId);
    if (!connection || connection.socket.readyState !== WebSocket.OPEN || !connection.capabilities.streamRead || (input.mode === "remux" && !connection.capabilities.streamRemux)) {
      throw new Error("Companion streaming is unavailable");
    }
    const requestId = crypto.randomUUID();
    const message = companionStreamOpenSchema.parse({ type: "stream.open", requestId, ...input });
    return new Promise<StreamOpenResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingOpens.delete(requestId);
        reject(new Error("Companion did not prepare the stream in time"));
      }, companionStreamRequestTimeoutMs);
      timeout.unref();
      this.pendingOpens.set(requestId, { companionId: input.companionId, sessionId: input.sessionId, resolve, reject, timeout });
      send(connection.socket, message);
    });
  }

  async readStreamRange(input: { companionId: string; sessionId: string; offset: number; length: number }): Promise<Buffer> {
    const connection = this.connections.get(input.companionId);
    if (!connection || connection.socket.readyState !== WebSocket.OPEN || !connection.capabilities.streamRead) {
      throw new Error("Companion streaming is unavailable");
    }
    if (this.activeRangeByCompanion.has(input.companionId)) throw new Error("Companion stream is busy");
    const requestId = crypto.randomUUID();
    const message = companionStreamRangeSchema.parse({
      type: "stream.range",
      requestId,
      sessionId: input.sessionId,
      offset: input.offset,
      length: Math.min(input.length, companionStreamMaxRangeBytes)
    });
    return new Promise<Buffer>((resolve, reject) => {
      const timeout = setTimeout(() => this.rejectRange(requestId, new Error("Companion range request timed out")), companionStreamRequestTimeoutMs);
      timeout.unref();
      this.pendingRanges.set(requestId, { companionId: input.companionId, sessionId: input.sessionId, resolve, reject, timeout });
      this.activeRangeByCompanion.set(input.companionId, requestId);
      send(connection.socket, message);
    });
  }

  cancelStream(companionId: string, sessionId: string, reason: "client_closed" | "expired" | "superseded" | "error" = "client_closed"): void {
    const connection = this.connections.get(companionId);
    this.rejectForSession(companionId, sessionId, new Error("Companion stream cancelled"));
    if (!connection || connection.socket.readyState !== WebSocket.OPEN) return;
    send(connection.socket, { type: "stream.cancel", sessionId, reason });
  }

  async close(): Promise<void> {
    clearInterval(this.pingTimer);
    for (const { socket } of this.connections.values()) socket.terminate();
    this.connections.clear();
    for (const [requestId] of this.pendingOpens) this.rejectOpen(requestId, new Error("Tunnel closed"));
    for (const [requestId] of this.pendingRanges) this.rejectRange(requestId, new Error("Tunnel closed"));
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private accept(socket: WebSocket, request: IncomingMessage): void {
    let companionId: string | null = null;
    let authenticating = false;
    const remoteAddress = request.socket.remoteAddress ?? "unknown";
    const handshakeTimer = setTimeout(() => {
      if (!companionId) socket.close(4001, "authentication timeout");
    }, companionTunnelHandshakeTimeoutMs);
    handshakeTimer.unref();

    const cleanup = () => {
      clearTimeout(handshakeTimer);
      if (companionId && this.connections.get(companionId)?.socket === socket) {
        this.connections.delete(companionId);
        this.app.log.info({ companionId }, "Companion control tunnel disconnected");
        this.rejectForCompanion(companionId, new Error("Companion tunnel disconnected"));
      }
    };

    socket.on("close", cleanup);
    socket.on("error", () => undefined);
    socket.on("pong", () => {
      if (!companionId) return;
      const connection = this.connections.get(companionId);
      if (connection?.socket === socket) {
        connection.awaitingPong = false;
        connection.lastSeenAt = Date.now();
      }
    });
    socket.on("message", (data, isBinary) => {
      void this.handleMessage({ socket, data, isBinary, remoteAddress, getCompanionId: () => companionId, setCompanionId: (id) => { companionId = id; }, getAuthenticating: () => authenticating, setAuthenticating: (value) => { authenticating = value; }, handshakeTimer });
    });
  }

  private async handleMessage(input: {
    socket: WebSocket;
    data: RawData;
    isBinary: boolean;
    remoteAddress: string;
    getCompanionId: () => string | null;
    setCompanionId: (id: string) => void;
    getAuthenticating: () => boolean;
    setAuthenticating: (value: boolean) => void;
    handshakeTimer: NodeJS.Timeout;
  }): Promise<void> {
    const existingCompanionId = input.getCompanionId();
    if (existingCompanionId) {
      if (input.isBinary) {
        this.handleStreamBinary(existingCompanionId, Buffer.from(input.data as Buffer));
      } else {
        this.handleAuthenticatedMessage(existingCompanionId, rawMessageText(input.data));
      }
      return;
    }
    if (input.isBinary) {
      send(input.socket, { type: "tunnel.error", code: "protocol_error" });
      input.socket.close(4002, "binary handshake not supported");
      return;
    }
    const text = rawMessageText(input.data);
    if (Buffer.byteLength(text, "utf8") > companionTunnelMaxMessageBytes) {
      send(input.socket, { type: "tunnel.error", code: "protocol_error" });
      input.socket.close(4002, "message too large");
      return;
    }

    if (input.getAuthenticating()) {
      input.socket.close(4002, "concurrent handshake");
      return;
    }
    input.setAuthenticating(true);

    try {
      const parsed = companionTunnelHelloSchema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        send(input.socket, { type: "tunnel.error", code: "protocol_error" });
        input.socket.close(4002, "invalid hello");
        return;
      }
      const limited = rateLimit(`companion-tunnel:${input.remoteAddress}`, 12, 5 * 60 * 1000);
      if (!limited.allowed) {
        send(input.socket, { type: "tunnel.error", code: "authentication_failed" });
        input.socket.close(4003, "too many authentication attempts");
        return;
      }

      const hello = parsed.data;
      const verification = await verifyAgentCredentials(hello.credential, hello.companionId, { requirePaired: true });
      if (!verification.ok) {
        send(input.socket, { type: "tunnel.error", code: errorCode(verification.statusCode) });
        input.socket.close(4003, "authentication failed");
        return;
      }
      clearRateLimit(`companion-tunnel:${input.remoteAddress}`);

      const previous = this.connections.get(hello.companionId);
      if (previous && previous.socket !== input.socket) previous.socket.close(4000, "superseded by a newer tunnel");
      const now = Date.now();
      this.connections.set(hello.companionId, {
        socket: input.socket,
        connectedAt: now,
        lastSeenAt: now,
        awaitingPong: false,
        capabilities: hello.capabilities
      });
      input.setCompanionId(hello.companionId);
      clearTimeout(input.handshakeTimer);
      await prisma.companionAgent.update({
        where: { installationId: hello.companionId },
        data: {
          name: hello.companionName,
          version: hello.version,
          capabilities: {
            tunnelProtocolVersion: companionTunnelProtocolVersion,
            control: hello.capabilities.control,
            streamRead: hello.capabilities.streamRead,
            streamRemux: hello.capabilities.streamRemux,
            tunnelConnectedAt: new Date(now).toISOString()
          }
        }
      });
      send(input.socket, {
        type: "tunnel.ready",
        protocolVersion: companionTunnelProtocolVersion,
        companionId: hello.companionId,
        capabilities: hello.capabilities
      });
      this.app.log.info({ companionId: hello.companionId }, "Companion control tunnel connected");
    } catch {
      send(input.socket, { type: "tunnel.error", code: "protocol_error" });
      input.socket.close(4002, "invalid protocol message");
    } finally {
      input.setAuthenticating(false);
    }
  }

  private pingConnections(): void {
    for (const [companionId, connection] of this.connections) {
      if (connection.socket.readyState !== WebSocket.OPEN || connection.awaitingPong) {
        connection.socket.terminate();
        this.connections.delete(companionId);
        this.rejectForCompanion(companionId, new Error("Companion tunnel heartbeat timed out"));
        continue;
      }
      connection.awaitingPong = true;
      connection.socket.ping();
    }
  }

  private handleAuthenticatedMessage(companionId: string, text: string): void {
    if (Buffer.byteLength(text, "utf8") > companionTunnelMaxMessageBytes) {
      this.disconnect(companionId, "protocol message too large");
      return;
    }
    try {
      const value = JSON.parse(text);
      const ready = companionStreamReadySchema.safeParse(value);
      if (ready.success) {
        const pending = this.pendingOpens.get(ready.data.requestId);
        if (!pending || pending.companionId !== companionId || pending.sessionId !== ready.data.sessionId) return;
        this.pendingOpens.delete(ready.data.requestId);
        clearTimeout(pending.timeout);
        pending.resolve({ sizeBytes: ready.data.sizeBytes, mimeType: ready.data.mimeType });
        return;
      }
      const chunk = companionStreamChunkSchema.safeParse(value);
      if (chunk.success) {
        const pending = this.pendingRanges.get(chunk.data.requestId);
        if (!pending || pending.companionId !== companionId || pending.sessionId !== chunk.data.sessionId || pending.expectedBytes !== undefined) return;
        pending.expectedBytes = chunk.data.bytes;
        return;
      }
      const streamError = companionStreamErrorSchema.safeParse(value);
      if (streamError.success) {
        const error = new Error(`Companion stream error: ${streamError.data.code}`);
        const open = this.pendingOpens.get(streamError.data.requestId);
        if (open?.companionId === companionId && open.sessionId === streamError.data.sessionId) this.rejectOpen(streamError.data.requestId, error);
        const range = this.pendingRanges.get(streamError.data.requestId);
        if (range?.companionId === companionId && range.sessionId === streamError.data.sessionId) this.rejectRange(streamError.data.requestId, error);
      }
    } catch {
      this.disconnect(companionId, "invalid protocol message");
    }
  }

  private handleStreamBinary(companionId: string, data: Buffer): void {
    const requestId = this.activeRangeByCompanion.get(companionId);
    if (!requestId) {
      this.disconnect(companionId, "unexpected stream data");
      return;
    }
    const pending = this.pendingRanges.get(requestId);
    if (!pending || pending.expectedBytes === undefined || pending.expectedBytes !== data.length || data.length > companionStreamMaxRangeBytes) {
      this.rejectRange(requestId, new Error("Invalid stream chunk"));
      this.disconnect(companionId, "invalid stream chunk");
      return;
    }
    this.pendingRanges.delete(requestId);
    this.activeRangeByCompanion.delete(companionId);
    clearTimeout(pending.timeout);
    pending.resolve(data);
  }

  private rejectOpen(requestId: string, error: Error): void {
    const pending = this.pendingOpens.get(requestId);
    if (!pending) return;
    this.pendingOpens.delete(requestId);
    clearTimeout(pending.timeout);
    pending.reject(error);
  }

  private rejectRange(requestId: string, error: Error): void {
    const pending = this.pendingRanges.get(requestId);
    if (!pending) return;
    this.pendingRanges.delete(requestId);
    this.activeRangeByCompanion.delete(pending.companionId);
    clearTimeout(pending.timeout);
    pending.reject(error);
  }

  private rejectForCompanion(companionId: string, error: Error): void {
    for (const [requestId, pending] of this.pendingOpens) if (pending.companionId === companionId) this.rejectOpen(requestId, error);
    for (const [requestId, pending] of this.pendingRanges) if (pending.companionId === companionId) this.rejectRange(requestId, error);
  }

  private rejectForSession(companionId: string, sessionId: string, error: Error): void {
    for (const [requestId, pending] of this.pendingOpens) {
      if (pending.companionId === companionId && pending.sessionId === sessionId) this.rejectOpen(requestId, error);
    }
    for (const [requestId, pending] of this.pendingRanges) {
      if (pending.companionId === companionId && pending.sessionId === sessionId) this.rejectRange(requestId, error);
    }
  }
}

export function installCompanionControlTunnel(app: FastifyInstance): void {
  const registry = new CompanionControlTunnelRegistry(app);
  registries.set(app.server, registry);
  app.addHook("onClose", async () => {
    await registry.close();
    registries.delete(app.server);
  });
}

export function companionTunnelStatus(app: FastifyInstance, companionId: string): CompanionTunnelStatus {
  return registries.get(app.server)?.status(companionId)
    ?? { connected: false, connectedAt: null, lastSeenAt: null, protocolVersion: null, capabilities: null };
}

export function disconnectCompanionControlTunnel(app: FastifyInstance, companionId: string): void {
  registries.get(app.server)?.disconnect(companionId);
}

export function openCompanionStream(app: FastifyInstance, input: Parameters<CompanionControlTunnelRegistry["openStream"]>[0]): Promise<StreamOpenResult> {
  const registry = registries.get(app.server);
  if (!registry) return Promise.reject(new Error("Companion tunnel unavailable"));
  return registry.openStream(input);
}

export function readCompanionStreamRange(app: FastifyInstance, input: Parameters<CompanionControlTunnelRegistry["readStreamRange"]>[0]): Promise<Buffer> {
  const registry = registries.get(app.server);
  if (!registry) return Promise.reject(new Error("Companion tunnel unavailable"));
  return registry.readStreamRange(input);
}

export function cancelCompanionStream(app: FastifyInstance, companionId: string, sessionId: string, reason?: "client_closed" | "expired" | "superseded" | "error"): void {
  registries.get(app.server)?.cancelStream(companionId, sessionId, reason);
}

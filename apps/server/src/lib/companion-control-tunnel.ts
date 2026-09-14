import type { FastifyInstance } from "fastify";
import type { IncomingMessage } from "node:http";
import { Buffer } from "node:buffer";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import {
  companionTunnelHandshakeTimeoutMs,
  companionTunnelHelloSchema,
  companionTunnelMaxMessageBytes,
  companionTunnelPingIntervalMs,
  companionTunnelProtocolVersion,
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
  private readonly server = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    perMessageDeflate: false,
    maxPayload: companionTunnelMaxMessageBytes
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
    connection.socket.close(4003, reason);
  }

  async close(): Promise<void> {
    clearInterval(this.pingTimer);
    for (const { socket } of this.connections.values()) socket.terminate();
    this.connections.clear();
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

    if (input.getCompanionId()) {
      send(input.socket, { type: "tunnel.error", code: "unsupported_message" });
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
        continue;
      }
      connection.awaitingPong = true;
      connection.socket.ping();
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

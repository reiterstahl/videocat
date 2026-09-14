import {
  companionStreamCancelSchema,
  companionStreamOpenSchema,
  companionStreamRangeSchema,
  companionTunnelErrorSchema,
  companionTunnelHelloSchema,
  companionTunnelReadySchema,
  companionTunnelReconnectDelayMs,
  companionTunnelUrl,
  type CompanionTunnelCapabilities
} from "@videocat/shared";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

type TunnelLog = (message: string) => void;

type ControlTunnelOptions = {
  serverUrl: string;
  credential: string;
  companionId: string;
  companionName?: string;
  version: number;
  logInfo: TunnelLog;
  logWarn: TunnelLog;
  resolveStreamFile: (input: { diskId: string; relativePath: string }) => Promise<{ path: string; sizeBytes: number; mimeType: string } | null>;
};

export type CompanionControlTunnel = {
  stop: () => void;
};

const capabilities: CompanionTunnelCapabilities = {
  control: true,
  streamRead: true,
  streamRemux: process.env.COMPANION_REMOTE_REMUX_ENABLED === "true"
};

const execFileAsync = promisify(execFile);

function parseServerMessage(event: MessageEvent): unknown {
  if (typeof event.data === "string") return JSON.parse(event.data);
  if (event.data instanceof ArrayBuffer) return JSON.parse(Buffer.from(event.data).toString("utf8"));
  return null;
}

export function startCompanionControlTunnel(options: ControlTunnelOptions): CompanionControlTunnel {
  let stopped = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let reconnectAttempt = 0;
  let loggedReady = false;
  let credentialRejected = false;
  const streams = new Map<string, { path: string; sizeBytes: number; mimeType: string; expiresAtMs: number; temporary: boolean }>();

  async function clearStream(sessionId: string): Promise<void> {
    const stream = streams.get(sessionId);
    streams.delete(sessionId);
    if (stream?.temporary) await fs.rm(stream.path, { force: true }).catch(() => undefined);
  }

  async function remuxToTemporaryMp4(sourcePath: string, sessionId: string): Promise<{ path: string; sizeBytes: number; mimeType: string } | null> {
    if (!capabilities.streamRemux) return null;
    const directory = path.join(os.tmpdir(), "videocat-remote-remux");
    const destination = path.join(directory, `${sessionId}-${crypto.randomBytes(8).toString("hex")}.mp4`);
    try {
      await fs.mkdir(directory, { recursive: true });
      await execFileAsync(process.env.FFMPEG_PATH?.trim() || "ffmpeg", [
        "-nostdin", "-y", "-i", sourcePath,
        "-map", "0:v:0", "-map", "0:a?",
        "-c", "copy", "-movflags", "+faststart", destination
      ], { timeout: 120_000, maxBuffer: 256 * 1024 });
      const stat = await fs.stat(destination);
      const maxBytes = Number(process.env.COMPANION_REMOTE_REMUX_MAX_BYTES ?? 20 * 1024 ** 3);
      if (!stat.isFile() || stat.size <= 0 || !Number.isFinite(maxBytes) || stat.size > maxBytes) throw new Error("Invalid remux output");
      return { path: destination, sizeBytes: stat.size, mimeType: "video/mp4" };
    } catch {
      await fs.rm(destination, { force: true }).catch(() => undefined);
      return null;
    }
  }

  function send(next: WebSocket, value: object): void {
    if (next.readyState === WebSocket.OPEN) next.send(JSON.stringify(value));
  }

  async function handleStreamMessage(next: WebSocket, value: unknown): Promise<boolean> {
    const open = companionStreamOpenSchema.safeParse(value);
    if (open.success) {
      const expiresAtMs = new Date(open.data.expiresAt).getTime();
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
        send(next, { type: "stream.error", requestId: open.data.requestId, sessionId: open.data.sessionId, code: "expired" });
        return true;
      }
      try {
        const file = await options.resolveStreamFile({ diskId: open.data.diskId, relativePath: open.data.relativePath });
        if (!file) {
          send(next, { type: "stream.error", requestId: open.data.requestId, sessionId: open.data.sessionId, code: "not_available" });
          return true;
        }
        if (file.sizeBytes !== open.data.expectedSizeBytes) {
          send(next, { type: "stream.error", requestId: open.data.requestId, sessionId: open.data.sessionId, code: "not_available" });
          return true;
        }
        const prepared = open.data.mode === "remux"
          ? await remuxToTemporaryMp4(file.path, open.data.sessionId)
          : file;
        if (!prepared) {
          send(next, { type: "stream.error", requestId: open.data.requestId, sessionId: open.data.sessionId, code: "not_available" });
          return true;
        }
        await clearStream(open.data.sessionId);
        streams.set(open.data.sessionId, { ...prepared, expiresAtMs, temporary: open.data.mode === "remux" });
        send(next, { type: "stream.ready", requestId: open.data.requestId, sessionId: open.data.sessionId, sizeBytes: prepared.sizeBytes, mimeType: prepared.mimeType });
      } catch {
        send(next, { type: "stream.error", requestId: open.data.requestId, sessionId: open.data.sessionId, code: "read_failed" });
      }
      return true;
    }
    const range = companionStreamRangeSchema.safeParse(value);
    if (range.success) {
      const stream = streams.get(range.data.sessionId);
      if (!stream || stream.expiresAtMs <= Date.now()) {
        await clearStream(range.data.sessionId);
        send(next, { type: "stream.error", requestId: range.data.requestId, sessionId: range.data.sessionId, code: "expired" });
        return true;
      }
      if (range.data.offset >= stream.sizeBytes) {
        send(next, { type: "stream.error", requestId: range.data.requestId, sessionId: range.data.sessionId, code: "invalid_range" });
        return true;
      }
      const length = Math.min(range.data.length, stream.sizeBytes - range.data.offset);
      try {
        const handle = await fs.open(stream.path, "r");
        try {
          const data = Buffer.allocUnsafe(length);
          const result = await handle.read(data, 0, length, range.data.offset);
          if (result.bytesRead <= 0) throw new Error("empty range");
          const chunk = data.subarray(0, result.bytesRead);
          send(next, { type: "stream.chunk", requestId: range.data.requestId, sessionId: range.data.sessionId, sequence: 0, bytes: chunk.length, eof: range.data.offset + chunk.length >= stream.sizeBytes });
          if (next.readyState === WebSocket.OPEN) next.send(chunk);
        } finally {
          await handle.close();
        }
      } catch {
        send(next, { type: "stream.error", requestId: range.data.requestId, sessionId: range.data.sessionId, code: "read_failed" });
      }
      return true;
    }
    const cancel = companionStreamCancelSchema.safeParse(value);
    if (cancel.success) {
      await clearStream(cancel.data.sessionId);
      return true;
    }
    return false;
  }

  function scheduleReconnect(): void {
    if (stopped || credentialRejected || reconnectTimer) return;
    reconnectAttempt += 1;
    const delayMs = companionTunnelReconnectDelayMs(reconnectAttempt);
    options.logWarn(`Canal remoto desconectado. Reintentando en ${Math.ceil(delayMs / 1000)}s.`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delayMs);
    reconnectTimer.unref();
  }

  function connect(): void {
    if (stopped || socket) return;
    let next: WebSocket;
    try {
      next = new WebSocket(companionTunnelUrl(options.serverUrl));
    } catch {
      scheduleReconnect();
      return;
    }
    socket = next;

    next.addEventListener("open", () => {
      const hello = companionTunnelHelloSchema.parse({
        type: "tunnel.hello",
        protocolVersion: 1,
        companionId: options.companionId,
        credential: options.credential,
        companionName: options.companionName,
        version: options.version,
        capabilities
      });
      next.send(JSON.stringify(hello));
    });

    next.addEventListener("message", async (event) => {
      try {
        const data = parseServerMessage(event);
        const ready = companionTunnelReadySchema.safeParse(data);
        if (ready.success) {
          const wasReconnecting = reconnectAttempt > 0;
          reconnectAttempt = 0;
          if (!loggedReady || wasReconnecting) {
            loggedReady = true;
            options.logInfo(wasReconnecting ? "Canal remoto seguro reconectado al servidor." : "Canal remoto seguro conectado al servidor.");
          }
          return;
        }
        if (await handleStreamMessage(next, data)) return;
        const error = companionTunnelErrorSchema.safeParse(data);
        if (error.success) {
          if (error.data.code === "authentication_failed" || error.data.code === "credential_revoked") {
            credentialRejected = true;
            options.logWarn("Canal remoto rechazado. Genera un codigo nuevo y vuelve a emparejar este Companion.");
          } else {
            options.logWarn(`Canal remoto rechazado: ${error.data.code}.`);
          }
          next.close();
        }
      } catch {
        options.logWarn("Canal remoto recibio una respuesta invalida.");
        next.close();
      }
    });

    next.addEventListener("error", () => undefined);
    next.addEventListener("close", () => {
      if (socket === next) socket = null;
      scheduleReconnect();
    });
  }

  connect();
  return {
    stop: () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      const active = socket;
      socket = null;
      if (active && (active.readyState === WebSocket.OPEN || active.readyState === WebSocket.CONNECTING)) {
        active.close(1000, "companion stopped");
      }
      void Promise.all([...streams.keys()].map((sessionId) => clearStream(sessionId)));
    }
  };
}

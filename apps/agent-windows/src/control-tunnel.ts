import {
  companionTunnelErrorSchema,
  companionTunnelHelloSchema,
  companionTunnelReadySchema,
  companionTunnelReconnectDelayMs,
  companionTunnelUrl,
  type CompanionTunnelCapabilities
} from "@videocat/shared";

type TunnelLog = (message: string) => void;

type ControlTunnelOptions = {
  serverUrl: string;
  credential: string;
  companionId: string;
  companionName?: string;
  version: number;
  logInfo: TunnelLog;
  logWarn: TunnelLog;
};

export type CompanionControlTunnel = {
  stop: () => void;
};

const capabilities: CompanionTunnelCapabilities = {
  control: true,
  streamRead: false
};

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

    next.addEventListener("message", (event) => {
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
    }
  };
}

import { contextBridge, ipcRenderer } from "electron";

type TrayConfig = Record<string, string>;
type TrayConfigSaveResult = { ok: true; path: string } | { ok: false; message: string };
type TrayPairingResult = { ok: true; companionId: string; issuedAt: string } | { ok: false; message: string };
type TrayPairingStatus = {
  paired: boolean;
  companionId: string | null;
  serverUrl: string | null;
  issuedAt: string | null;
  encryptionAvailable: boolean;
};
type TrayDrive = {
  root: string;
  diskId?: string;
  diskName?: string;
  totalBytes?: number;
  freeBytes?: number;
};
type TrayMarkerResult =
  | { ok: true; root: string; diskId: string; diskName: string; removedTargetId: string | null; pausedTargetIds: string[] }
  | { ok: false; message: string };
type TrayIdentityCheck =
  | { ok: true; root: string; diskName: string | null; check: { verdict: "empty" | "match" | "mixed" | "mismatch"; checked: number; matched: number; totalFiles: number } }
  | { ok: false; message: string };
type TrayHealthStatus = { supported: boolean; installed: boolean; administrator: boolean; lastCheckedAt: string | null };
type TrayHealthResult = { ok: boolean; message: string };
type TrayUpdateStatus = {
  installed: boolean;
  currentVersion: string;
  readyVersion: string | null;
  message?: string;
};
type TrayLogEntry = {
  id: number;
  timestamp: string;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
};

contextBridge.exposeInMainWorld("videocatConfig", {
  load: (): Promise<TrayConfig> => ipcRenderer.invoke("config:load") as Promise<TrayConfig>,
  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke("config:choose-folder") as Promise<string | null>,
  listDrives: (): Promise<TrayDrive[]> => ipcRenderer.invoke("config:list-drives") as Promise<TrayDrive[]>,
  convertDrive: (input: { root: string; name: string }): Promise<TrayMarkerResult> =>
    ipcRenderer.invoke("config:convert-drive", input) as Promise<TrayMarkerResult>,
  checkIdentity: (targetId: string, root: string): Promise<TrayIdentityCheck> =>
    ipcRenderer.invoke("config:check-identity", targetId, root) as Promise<TrayIdentityCheck>,
  pinIdentity: (input: { targetId: string; root: string; name: string; acceptMixed?: boolean }): Promise<TrayMarkerResult> =>
    ipcRenderer.invoke("config:pin-identity", input) as Promise<TrayMarkerResult>,
  healthStatus: (): Promise<TrayHealthStatus> => ipcRenderer.invoke("health:status") as Promise<TrayHealthStatus>,
  enableHealth: (): Promise<TrayHealthResult> => ipcRenderer.invoke("health:enable") as Promise<TrayHealthResult>,
  disableHealth: (): Promise<TrayHealthResult> => ipcRenderer.invoke("health:disable") as Promise<TrayHealthResult>,
  checkHealth: (): Promise<TrayHealthResult> => ipcRenderer.invoke("health:check") as Promise<TrayHealthResult>,
  save: (values: TrayConfig): Promise<TrayConfigSaveResult> =>
    ipcRenderer.invoke("config:save", values) as Promise<TrayConfigSaveResult>,
  pairingStatus: (): Promise<TrayPairingStatus> =>
    ipcRenderer.invoke("config:pairing-status") as Promise<TrayPairingStatus>,
  pair: (code: string, values: TrayConfig): Promise<TrayPairingResult> =>
    ipcRenderer.invoke("config:pair", code, values) as Promise<TrayPairingResult>,
  copyToken: (): Promise<boolean> => ipcRenderer.invoke("config:copy-token") as Promise<boolean>,
  updateStatus: (): Promise<TrayUpdateStatus> => ipcRenderer.invoke("update:status") as Promise<TrayUpdateStatus>,
  checkForUpdates: (): Promise<TrayUpdateStatus> => ipcRenderer.invoke("update:check") as Promise<TrayUpdateStatus>,
  installUpdate: (): void => ipcRenderer.send("update:install"),
  onUpdateReady: (callback: (status: TrayUpdateStatus) => void): void => {
    ipcRenderer.on("update:ready", (_event, status: TrayUpdateStatus) => callback(status));
  },
  close: (): void => ipcRenderer.send("config:close")
});

contextBridge.exposeInMainWorld("videocatLog", {
  load: (): Promise<TrayLogEntry[]> => ipcRenderer.invoke("log:load") as Promise<TrayLogEntry[]>,
  clear: (): Promise<{ ok: true }> => ipcRenderer.invoke("log:clear") as Promise<{ ok: true }>,
  close: (): void => ipcRenderer.send("log:close"),
  onEntry: (callback: (entry: TrayLogEntry) => void): void => {
    ipcRenderer.on("log:entry", (_event, entry: TrayLogEntry) => callback(entry));
  },
  onCleared: (callback: () => void): void => {
    ipcRenderer.on("log:cleared", () => callback());
  }
});

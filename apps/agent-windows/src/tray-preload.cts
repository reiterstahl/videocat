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
};
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

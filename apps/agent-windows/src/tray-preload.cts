import { contextBridge, ipcRenderer } from "electron";

type TrayConfig = Record<string, string>;
type TrayConfigSaveResult = { ok: true; path: string } | { ok: false; message: string };
type TrayDrive = {
  root: string;
  diskId?: string;
  diskName?: string;
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

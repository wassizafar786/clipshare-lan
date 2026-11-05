import { contextBridge, ipcRenderer } from "electron";
import type { AppStateSnapshot, HistoryEntry, TransferProgress } from "./types";

contextBridge.exposeInMainWorld("clipshare", {
  getState: (): Promise<AppStateSnapshot> => ipcRenderer.invoke("state:get"),
  beginPairing: (): Promise<string> => ipcRenderer.invoke("pair:begin"),
  cancelPairing: (): Promise<void> => ipcRenderer.invoke("pair:cancel"),
  pairWith: (peerId: string, code: string): Promise<void> =>
    ipcRenderer.invoke("pair:with", peerId, code),
  setSync: (on: boolean): Promise<void> => ipcRenderer.invoke("sync:set", on),
  setName: (name: string): Promise<void> => ipcRenderer.invoke("name:set", name),
  addManualPeer: (host: string, port: number, name?: string): Promise<string> =>
    ipcRenderer.invoke("peer:manual", host, port, name),
  unpairPeer: (peerId: string): Promise<void> => ipcRenderer.invoke("peer:unpair", peerId),
  checkUpdate: () => ipcRenderer.invoke("update:check"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: (): Promise<void> => ipcRenderer.invoke("update:install"),
  openUpdate: (): Promise<void> => ipcRenderer.invoke("update:open"),
  pickFiles: (): Promise<string[]> => ipcRenderer.invoke("files:pick"),
  sendFiles: (peerId: string, filePaths: string[]): Promise<TransferProgress[]> =>
    ipcRenderer.invoke("files:send", peerId, filePaths),
  listHistory: (): Promise<HistoryEntry[]> => ipcRenderer.invoke("history:list"),
  deleteHistory: (id: string): Promise<boolean> => ipcRenderer.invoke("history:delete", id),
  clearHistory: (): Promise<void> => ipcRenderer.invoke("history:clear"),
  copyHistory: (id: string): Promise<boolean> => ipcRenderer.invoke("history:copy", id),
  openHistoryFile: (id: string): Promise<boolean> => ipcRenderer.invoke("history:open", id),
  showHistoryFile: (id: string): Promise<boolean> => ipcRenderer.invoke("history:show", id),
  openReceiveFolder: (): Promise<void> => ipcRenderer.invoke("history:openReceiveFolder"),
  onState: (cb: (s: AppStateSnapshot) => void) => {
    const handler = (_: unknown, s: AppStateSnapshot) => cb(s);
    ipcRenderer.on("state", handler);
    return () => ipcRenderer.removeListener("state", handler);
  },
});

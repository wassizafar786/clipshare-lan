import { contextBridge, ipcRenderer } from "electron";
import type { AppStateSnapshot } from "./types";

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
  openUpdate: (): Promise<void> => ipcRenderer.invoke("update:open"),
  onState: (cb: (s: AppStateSnapshot) => void) => {
    const handler = (_: unknown, s: AppStateSnapshot) => cb(s);
    ipcRenderer.on("state", handler);
    return () => ipcRenderer.removeListener("state", handler);
  },
});

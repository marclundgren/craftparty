import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("craftparty", {
  preflight: () => ipcRenderer.invoke("preflight"),
  listWorlds: () => ipcRenderer.invoke("list-worlds"),
  deleteWorld: (worldId: string) => ipcRenderer.invoke("delete-world", worldId),
  revealWorld: (worldId: string) => ipcRenderer.invoke("reveal-world", worldId),
  startParty: (opts: {
    worldId?: string;
    worldName?: string;
    acceptEula: boolean;
    remote: boolean;
    addonIds: string[];
  }) => ipcRenderer.invoke("start-party", opts),
  stopParty: () => ipcRenderer.invoke("stop-party"),
  joinParty: (inviteCode: string) => ipcRenderer.invoke("join-party", inviteCode),
  leaveParty: () => ipcRenderer.invoke("leave-party"),
  copy: (text: string) => ipcRenderer.invoke("copy", text),
  getAddons: () => ipcRenderer.invoke("get-addons"),
  openMarketplace: () => ipcRenderer.invoke("open-marketplace"),
  onPhase: (cb: (phase: string) => void) =>
    ipcRenderer.on("phase", (_e, phase) => cb(phase)),
  onLog: (cb: (source: string, line: string) => void) =>
    ipcRenderer.on("log", (_e, source, line) => cb(source, line)),
});

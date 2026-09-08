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
    worldConfig?: { difficulty?: string; hardcore?: boolean; seed?: string };
  }) => ipcRenderer.invoke("start-party", opts),
  stopParty: () => ipcRenderer.invoke("stop-party"),
  joinParty: (inviteCode: string) => ipcRenderer.invoke("join-party", inviteCode),
  rejoinParty: (partyId: string) => ipcRenderer.invoke("rejoin-party", partyId),
  listParties: () => ipcRenderer.invoke("list-parties"),
  checkParty: (partyId: string) => ipcRenderer.invoke("check-party", partyId),
  leaveParty: (partyId?: string) => ipcRenderer.invoke("leave-party", partyId),
  forgetParty: (partyId: string) => ipcRenderer.invoke("forget-party", partyId),
  copy: (text: string) => ipcRenderer.invoke("copy", text),
  getAddons: () => ipcRenderer.invoke("get-addons"),
  openMarketplace: () => ipcRenderer.invoke("open-marketplace"),
  openSponsors: () => ipcRenderer.invoke("open-sponsors"),
  updateState: () => ipcRenderer.invoke("update-state"),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("download-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  setAutoUpdate: (on: boolean) => ipcRenderer.invoke("set-auto-update", on),
  openReleases: () => ipcRenderer.invoke("open-releases"),
  onUpdateState: (cb: (state: unknown) => void) =>
    ipcRenderer.on("update-state", (_e, state) => cb(state)),
  onPhase: (cb: (phase: string) => void) =>
    ipcRenderer.on("phase", (_e, phase) => cb(phase)),
  onLog: (cb: (source: string, line: string) => void) =>
    ipcRenderer.on("log", (_e, source, line) => cb(source, line)),
});

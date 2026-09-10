/*
 * A stand-in for the preload bridge (src/preload.ts), so the renderer can
 * be driven without a real party running. Used only by the screenshot
 * capture. It is never bundled into the app.
 *
 * Query string picks the scene: ?s=host|join|running, ?net=<verdict>,
 * ?worlds=N, ?parties=N. With no ?s the host form is shown as it is on
 * first launch.
 */
(() => {
// Stub of the preload bridge, for laying the UI out in a browser.
const P = new URLSearchParams(location.search);
const N = (k, d) => Number(P.get(k) ?? d);

const worlds = Array.from({ length: N("worlds", 3) }, (_, i) => ({
  id: `world-${i}`,
  name: ["Castle Hill", "Dragon Cave", "Skyblock Redux", "Test", "Old One", "Sixth"][i] ?? `World ${i}`,
  lastPlayedAt: new Date(Date.now() - i * 86400000).toISOString(),
  sizeBytes: 12_000_000 * (i + 1),
  minecraftVersion: "26.2",
  addonIds: [],
}));

const parties = Array.from({ length: N("parties", 2) }, (_, i) => ({
  id: `party-${i}`,
  name: ["Nora's world", "weekend build"][i] ?? `Party ${i}`,
  host: "100.64.0.3",
  port: 25565,
  connected: i === 0,
  localPort: 25566,
  lastJoinedAt: new Date(Date.now() - i * 86400000).toISOString(),
  minecraftVersion: "26.2",
}));

window.craftparty = {
  preflight: async () => {
    const net = P.get("net") ?? "independent-maybe";
    if (net === "error") return { error: "getaddrinfo ENOTFOUND api.ipify.org" };
    const cgnat = net === "assisted";
    return {
      verdict: net,
      publicIp: cgnat ? "100.71.4.19" : "203.0.113.42",
      publicIpKind: cgnat ? "cgnat" : "public",
      upnp: {
        found: !cgnat,
        friendlyName: cgnat ? null : "FRITZ!Box 7590",
        externalIp: cgnat ? null : "203.0.113.42",
        externalIpKind: cgnat ? null : "public",
      },
      mappingTest: { ran: false, mapped: false, loopbackReached: null, error: null },
      reasons: ["UPnP works and the router holds a public IP. Inbound reachability wasn't fully verified."],
      warnings: [],
    };
  },
  listWorlds: async () => ({ worlds }),
  deleteWorld: async () => ({ deleted: true }),
  revealWorld: async () => ({ ok: true }),
  startParty: async () => ({
    inviteCode: "eyJ2IjoxLCJwYXJ0eSI6IjhmM2EiLCJrZXkiOiJhYmNkZWZnaGlqa2xtbm9wIn0",
    port: 25565,
    worldName: "Castle Hill",
    remote: true,
    minecraftVersion: "26.2",
  }),
  stopParty: async () => ({ worldId: "world-0" }),
  joinParty: async () => ({ ok: true }),
  rejoinParty: async () => ({ ok: true }),
  listParties: async () => ({ parties }),
  checkParty: async (id) => ({ state: id === "party-0" ? "online" : "offline", pingMs: 34, version: "26.2", players: { online: 2, max: 8 } }),
  leaveParty: async () => ({ ok: true }),
  forgetParty: async () => ({ ok: true }),
  copy: async () => ({ ok: true }),
  getAddons: async () => ({
    addons: [
      { id: "a1", name: "Sleep Vote", emoji: "🛏️", tagline: "one player sleeping skips the night" },
      { id: "a2", name: "Graves", emoji: "⚰️", tagline: "your stuff waits where you died" },
    ],
  }),
  minecraftVersion: async () => ({ version: "26.2" }),
  openMarketplace: async () => {},
  openSponsors: async () => {},
  openWebsite: async () => {},
  updateState: async () => ({
    currentVersion: "0.9.0",
    latestVersion: "0.9.0",
    status: P.get("update") ?? "current",
    autoUpdate: true,
    selfInstall: true,
    note: "",
  }),
  checkForUpdates: async () => window.craftparty.updateState(),
  downloadUpdate: async () => window.craftparty.updateState(),
  installUpdate: async () => ({ ok: true }),
  setAutoUpdate: async () => window.craftparty.updateState(),
  openReleases: async () => {},
  onUpdateState: () => {},
  onPhase: () => {},
  onLog: () => {},
};

// Drive to the requested screen once app.js has wired everything up.
addEventListener("load", () => {
  setTimeout(() => {
    const s = P.get("s");
    if (s === "running") {
      const eula = document.getElementById("eula");
      eula.checked = true;
      eula.dispatchEvent(new Event("change"));
      const name = document.getElementById("world-name");
      name.value = "Castle Hill";
      name.dispatchEvent(new Event("input"));
      document.getElementById("start").click();
    }
    else if (s === "join") document.getElementById("tab-join").click();
    else if (s === "progress") document.getElementById("tab-host").click();
  }, 120);
});

})();

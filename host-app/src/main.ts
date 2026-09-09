import { app, BrowserWindow, dialog, ipcMain, clipboard, shell } from "electron";
import os from "node:os";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { dataDir } from "../../host-engine/src/platform.ts";
import { probe } from "../../preflight/src/probe.ts";
import {
  startParty,
  type PartyHandle,
  type PartyOptions,
} from "../../host-engine/src/party.ts";
import {
  parseWorldConfig,
  type WorldConfigInput,
} from "../../host-engine/src/world-config.ts";
import { joinParty, type JoinHandle } from "../../host-engine/src/joiner.ts";
import {
  forgetParty,
  getParty,
  listParties,
  recordJoined,
  rememberParty,
  type JoinedParty,
} from "../../host-engine/src/parties.ts";
import {
  pingControlPlane,
  pingMinecraft,
} from "../../host-engine/src/party-status.ts";
import {
  createWorld,
  deleteWorld,
  getWorld,
  listWorlds,
  recordPlayed,
} from "../../host-engine/src/worlds.ts";
import { latestSupportedMinecraft } from "../../host-engine/src/versions.ts";
import { reapStaleChildren } from "../../host-engine/src/pids.ts";
import {
  check as checkForUpdates,
  download as downloadUpdate,
  initUpdater,
  installNow,
  openReleasesPage,
  setAutoUpdate,
  updateState,
} from "./updater.ts";

app.setName("Craftparty");

let win: BrowserWindow | null = null;
let party: PartyHandle | null = null;
let starting = false;

/**
 * Every party this computer is currently connected to, by party id.
 * Friends can be in several worlds at once — each connection is its own
 * tailscaled and its own loopback proxy — so this is a map, not a slot.
 * The saved list of parties (including the ones nobody is connected to)
 * lives on disk in host-engine/src/parties.ts.
 */
const joins = new Map<string, JoinHandle>();

// Self-test instances need isolated Chromium profiles (two app instances
// otherwise deadlock on the shared userData singleton lock) and no GPU.
const selftestRole = process.argv.some((a) => a.startsWith("--selftest-host="))
  ? "host"
  : process.argv.some((a) => a.startsWith("--selftest-join="))
    ? "join"
    : null;
if (selftestRole) {
  app.setPath(
    "userData",
    path.join(app.getPath("temp"), `craftparty-selftest-${selftestRole}`),
  );
  app.disableHardwareAcceleration();
}

/**
 * Packaged builds get their icon from the bundle that electron-builder
 * makes out of build/icon.png. A dev run has no bundle, so point Electron
 * at the same source file — otherwise `npm start` shows the stock Electron
 * icon and the package name in the dock.
 */
const devIcon = (): string | undefined => {
  if (app.isPackaged) return undefined;
  const icon = path.join(__dirname, "..", "build", "icon.png");
  return fs.existsSync(icon) ? icon : undefined;
};

function createWindow() {
  win = new BrowserWindow({
    width: 760,
    // Tall enough that a card with a few saved worlds needs no scrolling at
    // all. Past that the card scrolls inside itself — the action button is
    // pinned either way (see .card-split in the stylesheet), so the minimum
    // only has to leave the scrolling middle something to show.
    height: 720,
    minWidth: 560,
    minHeight: 520,
    title: "Craftparty",
    icon: devIcon(),
    backgroundColor: "#a5d9f2",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  // Every link out of Craftparty belongs in the real browser. Left to
  // itself Electron answers target="_blank" with a chromeless window of
  // its own — no address bar, no back button, no way out of it — and
  // follows a plain href by replacing the app with the page.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openInBrowser(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    openInBrowser(url);
  });

  win.on("closed", () => {
    win = null;
  });
}

/** Hand a link to the system browser, ignoring anything that isn't one. */
function openInBrowser(url: string) {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
}

// Engine children keep emitting logs while the app tears them down on
// quit; sending to a destroyed window throws in the main process.
const send = (channel: string, ...args: unknown[]) => {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, ...args);
};

const REPORT_URL = "https://craftparty-ten.vercel.app/api/report";
const MARKETPLACE_URL = "https://craftparty-ten.vercel.app/marketplace";
const SPONSORS_URL = "https://github.com/sponsors/marclundgren";
const ADDONS_URL = "https://craftparty-ten.vercel.app/addons.json";

interface RegistryAddon {
  id: string;
  name: string;
  emoji: string;
  tagline: string;
  version: string;
  jars: Array<{ filename: string; url: string }>;
}

let addonsCache: RegistryAddon[] | null = null;

async function fetchAddons(): Promise<RegistryAddon[]> {
  if (addonsCache) return addonsCache;
  const res = await fetch(ADDONS_URL, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`addons registry: HTTP ${res.status}`);
  const data = (await res.json()) as { addons: RegistryAddon[] };
  addonsCache = data.addons;
  return addonsCache;
}

/**
 * Failed starts produce a diagnostic report: saved locally, posted to the
 * report endpoint (fire-and-forget), and returned to the renderer so the
 * user can copy it. Contains app/OS versions, the phase reached, the
 * error, and recent engine logs — no account data.
 */
async function reportFailure(
  kind: "host" | "join",
  phase: string | null,
  logs: string[],
  err: unknown,
): Promise<{
  error: string;
  report: string;
  reportSent: boolean;
  reportPath: string | null;
}> {
  const error = err instanceof Error ? err.message : String(err);
  const report = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    app: app.getVersion(),
    kind,
    os: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    phase,
    error,
    logs: logs.slice(-150),
  };
  const text = JSON.stringify(report, null, 2);
  let reportPath: string | null = null;
  try {
    const dir = path.join(dataDir(), "reports");
    await fsp.mkdir(dir, { recursive: true });
    reportPath = path.join(dir, `${report.id}.json`);
    await fsp.writeFile(reportPath, text);
  } catch {
    reportPath = null;
  }
  let reportSent = false;
  try {
    const res = await fetch(REPORT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(8000),
    });
    reportSent = res.ok;
  } catch {
    reportSent = false;
  }
  return { error, report: text, reportSent, reportPath };
}

ipcMain.handle("preflight", async () => {
  try {
    return await probe({ runMappingTest: false });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("get-addons", async () => {
  try {
    const addons = await fetchAddons();
    return {
      addons: addons.map(({ id, name, emoji, tagline, version }) => ({
        id,
        name,
        emoji,
        tagline,
        version,
      })),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
});

/**
 * Which Minecraft a new world would be created on: the newest release
 * Fabric can serve today (see host-engine/src/versions.ts), not the
 * newest Mojang has shipped — those differ for a few days after every
 * Minecraft release, and only the first can actually be started.
 *
 * An error here is not a failure worth blocking on: the form says it
 * couldn't check and the start goes on to resolve it for real.
 */
ipcMain.handle("minecraft-version", async () => {
  try {
    return { version: await latestSupportedMinecraft() };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
});

// ---- updates ----
// The renderer only ever reflects this state; every transition is driven
// by the main process and pushed down through the "update-state" channel.
ipcMain.handle("update-state", () => updateState());
ipcMain.handle("check-for-updates", () => checkForUpdates());
ipcMain.handle("download-update", () => downloadUpdate());
ipcMain.handle("set-auto-update", (_event, on: boolean) => setAutoUpdate(!!on));
ipcMain.handle("open-releases", () => {
  openReleasesPage();
  return { ok: true };
});

// Installing restarts the app, which would drop everyone out of a running
// world mid-block. Refuse while anything is live and say why — an update
// that is already downloaded loses nothing by waiting for the next quit.
ipcMain.handle("install-update", () => {
  if (party) {
    return { error: "Stop the party first — installing restarts Craftparty." };
  }
  if (joins.size > 0) {
    return {
      error:
        joins.size === 1
          ? "Leave the party first — installing restarts Craftparty."
          : "Leave your parties first — installing restarts Craftparty.",
    };
  }
  installNow();
  return { ok: true };
});

ipcMain.handle("open-marketplace", () => {
  shell.openExternal(MARKETPLACE_URL);
  return { ok: true };
});

// Sponsoring happens on github.com, in the browser — Craftparty never
// sees a payment, and deliberately has no account of its own to ask for.
ipcMain.handle("open-sponsors", () => {
  shell.openExternal(SPONSORS_URL);
  return { ok: true };
});

// Worlds live on disk between parties; the host decides when one goes
// away. Everything the picker needs, newest-played first.
ipcMain.handle("list-worlds", async () => {
  try {
    const worlds = await listWorlds();
    return {
      worlds: worlds.map((w) => ({
        id: w.id,
        name: w.name,
        createdAt: w.createdAt,
        lastPlayedAt: w.lastPlayedAt,
        sizeBytes: w.sizeBytes,
        addonIds: w.addonIds,
        minecraftVersion: w.minecraftVersion,
      })),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
});

// Deleting a world is permanent, so the confirmation lives here rather
// than in the renderer: there is no path to rm without the host saying yes
// in a native dialog.
ipcMain.handle("delete-world", async (_event, worldId: string) => {
  try {
    const world = await getWorld(worldId);
    if (party?.world.id === world.id) {
      return { error: "That world is running right now — stop the party first." };
    }
    const { response } = await dialog.showMessageBox(win!, {
      type: "warning",
      buttons: ["Delete forever", "Keep it"],
      defaultId: 1,
      cancelId: 1,
      title: "Delete this world?",
      message: `Delete "${world.name}" forever?`,
      detail:
        "Everything built in this world is erased from this computer. This cannot be undone.",
    });
    if (response !== 0) return { deleted: false };
    await deleteWorld(world.id);
    return { deleted: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
});

// Escape hatch for backups: show the world's folder in the file manager.
ipcMain.handle("reveal-world", async (_event, worldId: string) => {
  try {
    const world = await getWorld(worldId);
    await shell.openPath(world.dir);
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle(
  "start-party",
  async (
    _event,
    opts: {
      /** Resume a saved world. */
      worldId?: string;
      /** Or create a new one under this name. */
      worldName?: string;
      acceptEula: boolean;
      remote: boolean;
      addonIds?: string[];
      /** Chosen in the UI; only takes effect on a brand-new world. */
      worldConfig?: WorldConfigInput;
    },
  ) => {
    if (party || starting) return { error: "A party is already running." };

    // Explicit either way: resuming and creating are never confused, so a
    // typo can't silently strand a world the host meant to resume. This
    // runs before the start proper — a name clash is something for the
    // host to fix, not a failure worth a diagnostic report.
    let world;
    let worldConfig;
    try {
      // Check the settings against world-config.ts before anything hits
      // the disk, so a value the engine doesn't recognise can't leave an
      // empty world directory behind.
      worldConfig = parseWorldConfig(opts.worldConfig);
      if (opts.worldId) {
        world = await getWorld(opts.worldId);
      } else {
        // A new world is pinned to today's newest hostable Minecraft and
        // keeps it for good; a saved one already has its own. Fabric
        // being unreachable isn't fatal — the world is created unpinned
        // and stamped with whatever the start actually runs.
        const version = await latestSupportedMinecraft().catch(() => null);
        world = await createWorld(opts.worldName ?? "", version);
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }

    starting = true;
    let phase: string | null = null;
    const logs: string[] = [];
    try {
      // Resolve selected addon ids to their jar downloads. A failure
      // here (registry unreachable) fails the start loudly rather than
      // silently launching a world without the addons the host chose.
      const addonJars =
        opts.addonIds && opts.addonIds.length > 0
          ? (await fetchAddons())
              .filter((a) => opts.addonIds!.includes(a.id))
              .flatMap((a) => a.jars)
          : [];

      const partyOpts: PartyOptions = {
        world,
        acceptEula: opts.acceptEula,
        mode: "independent",
        remote: opts.remote,
        addons: addonJars,
        worldConfig,
        onPhase: (p) => {
          phase = p;
          send("phase", p);
        },
        onLog: (source, line) => {
          logs.push(`[${source}] ${line}`);
          if (logs.length > 400) logs.splice(0, logs.length - 400);
          send("log", source, line);
        },
      };
      party = await startParty(partyOpts);
      const minecraftVersion = party.server.versions.minecraft;
      await recordPlayed(world.id, opts.addonIds ?? [], minecraftVersion).catch(
        () => {},
      );
      return {
        worldId: world.id,
        worldName: world.name,
        inviteCode: party.inviteCode,
        tailnetIp: party.tailnetIp,
        port: party.server.port,
        minecraftVersion,
        mode: party.mode,
        remote: opts.remote,
      };
    } catch (err) {
      return await reportFailure("host", phase, logs, err);
    } finally {
      starting = false;
    }
  },
);

// Stopping shuts the Minecraft server down through its console `stop`
// command, so the world is saved and left on disk for next time.
ipcMain.handle("stop-party", async () => {
  if (!party) return { ok: true };
  const { id: worldId, name: worldName } = party.world;
  await party.stop();
  party = null;
  return { ok: true, worldId, worldName };
});

/**
 * Connect to one saved party. Joining probes for free loopback ports
 * (the SOCKS proxy, then the one Minecraft dials), and two of those
 * racing would happily pick the same number — so connections take turns,
 * and while one is in flight nothing else may claim the phase channel
 * the progress screen reads.
 */
async function connectToParty(saved: JoinedParty) {
  if (joins.has(saved.id)) {
    return { error: `You're already in "${saved.name}".` };
  }
  if (starting) {
    // `starting` is held by a host start too, not just another join.
    return {
      error: "Hang on — Craftparty is still getting another world ready.",
    };
  }
  starting = true;
  let phase: string | null = null;
  const logs: string[] = [];
  try {
    const handle = await joinParty(saved.inviteCode, {
      stateName: saved.id,
      onPhase: (p) => {
        phase = p;
        send("phase", p);
      },
      onLog: (source, line) => {
        logs.push(`[${source}] ${line}`);
        if (logs.length > 400) logs.splice(0, logs.length - 400);
        send("log", source, line);
      },
    });
    joins.set(saved.id, handle);
    await recordJoined(saved.id).catch(() => {});
    return {
      partyId: saved.id,
      partyName: saved.name,
      localPort: handle.localPort,
    };
  } catch (err) {
    return await reportFailure("join", phase, logs, err);
  } finally {
    starting = false;
  }
}

// Pasting an invite: remember the party first, so it stays in the list
// (and can be retried or forgotten) even if this connection attempt
// fails. A re-paste of a party already saved refreshes its invite.
ipcMain.handle("join-party", async (_event, inviteCode: string) => {
  let saved: JoinedParty;
  try {
    saved = await rememberParty(inviteCode);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  console.log(
    `join-party invoked (joined=${joins.size} starting=${starting}) party=${saved.id}`,
  );
  return await connectToParty(saved);
});

// Rejoining from the list: the invite never leaves the main process.
ipcMain.handle("rejoin-party", async (_event, partyId: string) => {
  try {
    return await connectToParty(await getParty(partyId));
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
});

// Every party the friend has joined, connected or not. Deliberately
// without the invite code: it carries the host's auth key, and nothing
// in the renderer needs it — rejoining goes by id.
ipcMain.handle("list-parties", async () => {
  try {
    const parties = await listParties();
    return {
      parties: parties.map((p) => ({
        id: p.id,
        name: p.name,
        host: p.host,
        port: p.port,
        minecraftVersion: p.minecraftVersion,
        addedAt: p.addedAt,
        lastJoinedAt: p.lastJoinedAt,
        connected: joins.has(p.id),
        localPort: joins.get(p.id)?.localPort ?? null,
      })),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
});

// How is this party doing right now? Connected, that is a real
// server-list ping through the proxy; otherwise the most that can be
// asked is whether the host's control plane is still up.
ipcMain.handle("check-party", async (_event, partyId: string) => {
  const handle = joins.get(partyId);
  if (handle) return await pingMinecraft("127.0.0.1", handle.localPort);
  try {
    const saved = await getParty(partyId);
    return await pingControlPlane(saved.controlPlaneUrl);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
});

// Leaving one party, or (with no id — the shutdown path) all of them.
ipcMain.handle("leave-party", async (_event, partyId?: string) => {
  const ids = partyId ? [partyId] : [...joins.keys()];
  for (const id of ids) {
    const handle = joins.get(id);
    if (!handle) continue;
    // Drop it from the map first: a stop that hangs must not leave the
    // party looking joinable while its proxy is still winding down.
    joins.delete(id);
    await handle.stop().catch(() => {});
  }
  return { ok: true };
});

// Forgetting only removes the party from the list — nothing on this
// computer or the host's is touched. Being connected is the one thing
// that blocks it; yanking someone out of a world they are playing is not
// what "forget" should mean.
ipcMain.handle("forget-party", async (_event, partyId: string) => {
  if (joins.has(partyId)) {
    return { error: "Leave this party before removing it from your list." };
  }
  try {
    return { forgotten: await forgetParty(partyId) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("copy", (_event, text: string) => {
  clipboard.writeText(text);
  return { ok: true };
});

app.whenReady().then(() => {
  reapStaleChildren().then((reaped) => {
    for (const r of reaped) console.log(`reaped stale child: ${r}`);
  });
  createWindow();
  // Fire-and-forget: a machine that can't reach GitHub still gets a
  // working app, just without update news.
  void initUpdater((state) => send("update-state", state));

  // Self-test hook: --screenshot=/path/out.png captures the window and exits.
  const shotArg = process.argv.find((a) => a.startsWith("--screenshot="));
  if (shotArg) {
    const out = shotArg.split("=")[1];
    setTimeout(async () => {
      try {
        const image = await win!.webContents.capturePage();
        const fs = await import("node:fs/promises");
        await fs.writeFile(out, image.toPNG());
        console.log(`screenshot written: ${out}`);
      } finally {
        app.quit();
      }
    }, 4000);
  }

  // Full E2E self-test: drives the real UI (form -> Start -> invite ->
  // Stop) through the same renderer/IPC/engine path a user exercises.
  // --selftest=/path/prefix writes prefix-running.png on success.
  const selftestArg = process.argv.find((a) => a.startsWith("--selftest="));
  if (selftestArg) {
    const prefix = selftestArg.split("=")[1];
    const page = win!.webContents;
    const shot = async (name: string) => {
      const fs = await import("node:fs/promises");
      await fs.writeFile(
        `${prefix}-${name}.png`,
        (await page.capturePage()).toPNG(),
      );
    };
    setTimeout(async () => {
      let ok = false;
      try {
        // Give the addons registry fetch a moment, then tick the first
        // addon so the selftest exercises the full addon pipeline.
        await new Promise((r) => setTimeout(r, 4000));
        await page.executeJavaScript(`
          (() => {
            const name = document.getElementById("world-name");
            name.value = "Self Test";
            name.dispatchEvent(new Event("input"));
            const eula = document.getElementById("eula");
            eula.checked = true;
            eula.dispatchEvent(new Event("change"));
            const remote = document.getElementById("remote");
            if (!remote.disabled) { remote.checked = false; }
            const addon = document.querySelector("#addons-list input");
            if (addon) {
              addon.checked = true;
              addon.dispatchEvent(new Event("change"));
            }
            document.getElementById("start").click();
          })()
        `);
        const deadline = Date.now() + 8 * 60_000;
        for (;;) {
          const state = await page.executeJavaScript(`({
            running: !document.getElementById("running").hidden,
            error: document.getElementById("setup-error").textContent,
            invite: document.getElementById("invite").value,
          })`);
          if (state.running && state.invite) {
            console.log(`selftest: RUNNING, invite ${state.invite.length} chars`);
            await shot("running");
            await page.executeJavaScript(
              `document.getElementById("stop").click()`,
            );
            await new Promise((r) => setTimeout(r, 3000));
            ok = true;
            break;
          }
          if (state.error) {
            console.error(`selftest: FAILED — ${state.error}`);
            await shot("error");
            break;
          }
          if (Date.now() > deadline) {
            console.error("selftest: TIMEOUT");
            await shot("timeout");
            break;
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
      } finally {
        console.log(ok ? "selftest: OK" : "selftest: NOT OK");
        app.exit(ok ? 0 : 1);
      }
    }, 5000);
  }
});

// Dual-instance UI E2E: --selftest-host=<inviteFile> hosts a party via
// the real UI and writes the invite code to a file; --selftest-join=<same
// file> pastes it into the Join tab, waits for the connected screen, then
// verifies an actual Minecraft status ping through the joiner's proxy.
function armDualSelftest() {
  const hostArg = process.argv.find((a) => a.startsWith("--selftest-host="));
  const joinArg = process.argv.find((a) => a.startsWith("--selftest-join="));
  if (!hostArg && !joinArg) return;
  const file = (hostArg ?? joinArg)!.split("=")[1];
  const page = () => win!.webContents;
  const poll = async <T>(
    ms: number,
    fn: () => Promise<T | null>,
  ): Promise<T> => {
    const deadline = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > deadline) throw new Error("selftest poll timeout");
      await new Promise((r) => setTimeout(r, 2000));
    }
  };

  setTimeout(async () => {
    const fs = await import("node:fs/promises");
    const fss = await import("node:fs");
    try {
      if (hostArg) {
        await page().executeJavaScript(`(() => {
          const name = document.getElementById("world-name");
          name.value = "Selftest Duo";
          name.dispatchEvent(new Event("input"));
          const eula = document.getElementById("eula");
          eula.checked = true;
          eula.dispatchEvent(new Event("change"));
          const remote = document.getElementById("remote");
          if (!remote.disabled) remote.checked = false;
          document.getElementById("start").click();
        })()`);
        const invite = await poll(8 * 60_000, async () => {
          const s = await page().executeJavaScript(
            `({ running: !document.getElementById("running").hidden,
                invite: document.getElementById("invite").value })`,
          );
          return s.running && s.invite ? (s.invite as string) : null;
        });
        await fs.writeFile(file, invite);
        console.log("selftest-host: party up, invite written");
        await poll(8 * 60_000, async () =>
          fss.existsSync(`${file}.done`) ? true : null,
        );
        await page().executeJavaScript(
          `document.getElementById("stop").click()`,
        );
        await new Promise((r) => setTimeout(r, 3000));
        console.log("selftest-host: OK");
        app.exit(0);
      } else {
        const invite = await poll(3 * 60_000, async () =>
          fss.existsSync(file) ? await fs.readFile(file, "utf8") : null,
        );
        // pass the invite safely via a JSON-escaped global, then drive the form
        await page().executeJavaScript(
          `window.__invite = ${JSON.stringify(invite.trim())}; (() => {
            document.getElementById("tab-join").click();
            const input = document.getElementById("invite-input");
            input.value = window.__invite;
            input.dispatchEvent(new Event("input"));
            document.getElementById("join").click();
          })()`,
        );
        const address = await poll(5 * 60_000, async () => {
          const s = await page().executeJavaScript(
            `(() => {
              const row = document.querySelector(".party-row.connected");
              return {
                address: row?.querySelector(".party-address")?.value ?? "",
                error: document.getElementById("join-error").textContent,
              };
            })()`,
          );
          if (s.error) throw new Error(`join failed: ${s.error}`);
          return s.address ? (s.address as string) : null;
        });
        const port = Number(address.split(":")[1]);
        const net = await import("node:net");
        const { minecraftStatus } = await import(
          "../../host-engine/src/mc-ping.ts"
        );
        const socket = net.connect({ host: "127.0.0.1", port });
        await new Promise<void>((resolve, reject) => {
          socket.once("connect", resolve);
          socket.once("error", reject);
        });
        const status = await minecraftStatus(socket, "127.0.0.1", port);
        socket.destroy();
        console.log(
          `selftest-join: Minecraft answered ${status.version?.name} on ${address}`,
        );
        const image = await page().capturePage();
        await fs.writeFile(`${file}-join.png`, image.toPNG());
        await page().executeJavaScript(
          `document.querySelector(".party-row.connected .party-leave").click()`,
        );
        await new Promise((r) => setTimeout(r, 2000));
        await fs.writeFile(`${file}.done`, "ok");
        console.log("selftest-join: OK");
        app.exit(0);
      }
    } catch (err) {
      console.error(
        `selftest ${hostArg ? "host" : "join"}: FAILED —`,
        err instanceof Error ? err.message : err,
      );
      app.exit(1);
    }
  }, 5000);
}

app.whenReady().then(armDualSelftest);

/**
 * Never leave a world behind on the way out. Both exits — closing the
 * window and quitting outright (Cmd+Q, the dock, a session logout) — stop
 * the Minecraft server through its console `stop` first, so the world is
 * saved to disk instead of being orphaned and hard-killed on next launch.
 */
let shuttingDown = false;

async function shutDownEngines(): Promise<void> {
  if (party) await party.stop().catch(() => {});
  party = null;
  for (const [id, handle] of joins) {
    joins.delete(id);
    await handle.stop().catch(() => {});
  }
}

app.on("window-all-closed", async () => {
  await shutDownEngines();
  app.quit();
});

app.on("before-quit", (event) => {
  if (shuttingDown || (!party && joins.size === 0)) return;
  // Hold the quit open while the world saves; a stuck server escalates to
  // SIGTERM inside stop(), so this can't wait forever.
  event.preventDefault();
  shuttingDown = true;
  shutDownEngines().finally(() => app.quit());
});

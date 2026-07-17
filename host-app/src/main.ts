import { app, BrowserWindow, ipcMain, clipboard } from "electron";
import os from "node:os";
import fsp from "node:fs/promises";
import path from "node:path";
import { dataDir } from "../../host-engine/src/platform.ts";
import { probe } from "../../preflight/src/probe.ts";
import {
  startParty,
  type PartyHandle,
  type PartyOptions,
} from "../../host-engine/src/party.ts";
import { joinParty, type JoinHandle } from "../../host-engine/src/joiner.ts";
import { reapStaleChildren } from "../../host-engine/src/pids.ts";

let win: BrowserWindow | null = null;
let party: PartyHandle | null = null;
let joined: JoinHandle | null = null;
let starting = false;

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

function createWindow() {
  win = new BrowserWindow({
    width: 760,
    height: 640,
    minWidth: 560,
    minHeight: 480,
    title: "Craftparty",
    backgroundColor: "#a5d9f2",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  win.on("closed", () => {
    win = null;
  });
}

// Engine children keep emitting logs while the app tears them down on
// quit; sending to a destroyed window throws in the main process.
const send = (channel: string, ...args: unknown[]) => {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, ...args);
};

const REPORT_URL = "https://craftparty-ten.vercel.app/api/report";

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

ipcMain.handle(
  "start-party",
  async (
    _event,
    opts: { worldName: string; acceptEula: boolean; remote: boolean },
  ) => {
    if (party || starting) return { error: "A party is already running." };
    starting = true;
    let phase: string | null = null;
    const logs: string[] = [];
    try {
      const partyOpts: PartyOptions = {
        worldName: opts.worldName,
        acceptEula: opts.acceptEula,
        mode: "independent",
        remote: opts.remote,
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
      return {
        inviteCode: party.inviteCode,
        tailnetIp: party.tailnetIp,
        port: party.server.port,
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

ipcMain.handle("stop-party", async () => {
  if (!party) return { ok: true };
  await party.stop();
  party = null;
  return { ok: true };
});

ipcMain.handle("join-party", async (_event, inviteCode: string) => {
  console.log(
    `join-party invoked (joined=${!!joined} starting=${starting}) invite=${inviteCode.slice(0, 12)}…`,
  );
  if (joined || starting) return { error: "Already connected to a party." };
  starting = true;
  let phase: string | null = null;
  const logs: string[] = [];
  try {
    joined = await joinParty(inviteCode, {
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
    return { localPort: joined.localPort, partyName: joined.invite.party };
  } catch (err) {
    return await reportFailure("join", phase, logs, err);
  } finally {
    starting = false;
  }
});

ipcMain.handle("leave-party", async () => {
  if (!joined) return { ok: true };
  await joined.stop();
  joined = null;
  return { ok: true };
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
            `({ connected: !document.getElementById("join-running").hidden,
                address: document.getElementById("join-address").value,
                error: document.getElementById("join-error").textContent })`,
          );
          if (s.error) throw new Error(`join failed: ${s.error}`);
          return s.connected && s.address ? (s.address as string) : null;
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
          `document.getElementById("leave").click()`,
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

app.on("window-all-closed", async () => {
  if (party) await party.stop().catch(() => {});
  if (joined) await joined.stop().catch(() => {});
  app.quit();
});

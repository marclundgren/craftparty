import { app, BrowserWindow, ipcMain, clipboard } from "electron";
import path from "node:path";
import { probe } from "../../preflight/src/probe.ts";
import {
  startParty,
  type PartyHandle,
  type PartyOptions,
} from "../../host-engine/src/party.ts";

let win: BrowserWindow | null = null;
let party: PartyHandle | null = null;
let starting = false;

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
}

const send = (channel: string, ...args: unknown[]) => {
  win?.webContents.send(channel, ...args);
};

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
    try {
      const partyOpts: PartyOptions = {
        worldName: opts.worldName,
        acceptEula: opts.acceptEula,
        mode: "independent",
        remote: opts.remote,
        onPhase: (phase) => send("phase", phase),
        onLog: (source, line) => send("log", source, line),
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
      return { error: err instanceof Error ? err.message : String(err) };
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

ipcMain.handle("copy", (_event, text: string) => {
  clipboard.writeText(text);
  return { ok: true };
});

app.whenReady().then(() => {
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

app.on("window-all-closed", async () => {
  if (party) await party.stop().catch(() => {});
  app.quit();
});

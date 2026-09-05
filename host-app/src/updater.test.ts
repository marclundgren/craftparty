import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Run with:
 *   node --experimental-strip-types --experimental-test-module-mocks \
 *why    --test src/updater.test.ts
 *
 * The updater's job is deciding what to do, not talking to GitHub, so
 * electron and electron-updater are stood in for and the decisions are
 * checked directly.
 */
const home = await fsp.mkdtemp(path.join(os.tmpdir(), "craftparty-updater-"));
process.env.CRAFTPARTY_HOME = home;

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  checkResult: { isUpdateAvailable: boolean; updateInfo: { version: string } } | null =
    { isUpdateAvailable: false, updateInfo: { version: "0.3.0" } };
  checks = 0;
  downloads = 0;
  quitAndInstalls = 0;

  async checkForUpdates() {
    this.checks++;
    this.emit("checking-for-update");
    const result = this.checkResult;
    if (result === null) return null;
    if (result.isUpdateAvailable) this.emit("update-available", result.updateInfo);
    else this.emit("update-not-available", result.updateInfo);
    return result;
  }

  async downloadUpdate() {
    this.downloads++;
    this.emit("download-progress", { percent: 50 });
    this.emit("update-downloaded", { version: this.checkResult!.updateInfo.version });
    return ["/tmp/update"];
  }

  quitAndInstall() {
    this.quitAndInstalls++;
  }
}

const fake = new FakeUpdater();
let opened: string | null = null;

mock.module("electron", {
  namedExports: {
    app: { getVersion: () => "0.3.0", isPackaged: true },
    shell: { openExternal: async (url: string) => void (opened = url) },
  },
});
mock.module("electron-updater", { namedExports: { autoUpdater: fake } });

const updater = await import("./updater.ts");
const { forgetSettings } = await import("./settings.ts");

/** Fresh module state per case: the module holds one updater's state. */
async function boot(opts: { autoUpdate: boolean; available?: string | null }) {
  forgetSettings();
  await fsp.writeFile(
    path.join(home, "settings.json"),
    JSON.stringify({ autoUpdate: opts.autoUpdate }),
  );
  fake.removeAllListeners();
  fake.checks = 0;
  fake.downloads = 0;
  fake.quitAndInstalls = 0;
  fake.checkResult =
    opts.available === null
      ? null
      : {
          isUpdateAvailable: !!opts.available,
          updateInfo: { version: opts.available ?? "0.3.0" },
        };
  const seen: string[] = [];
  await updater.initUpdater((s) => seen.push(s.status));
  return seen;
}

test("no update: the app reports it is current", async () => {
  await boot({ autoUpdate: true });
  const state = updater.updateState();
  assert.equal(state.status, "current");
  assert.equal(state.currentVersion, "0.3.0");
  assert.equal(fake.downloads, 0, "nothing to download");
});

test("auto-update on: the update downloads and waits for the next launch", async () => {
  await boot({ autoUpdate: true, available: "0.4.0" });
  const state = updater.updateState();
  assert.equal(state.status, "ready");
  assert.equal(state.latestVersion, "0.4.0");
  assert.equal(fake.downloads, 1);
  assert.equal(
    fake.autoInstallOnAppQuit,
    true,
    "a downloaded update installs on the way out",
  );
});

test("auto-update off: the update is offered, not taken", async () => {
  await boot({ autoUpdate: false, available: "0.4.0" });
  assert.equal(updater.updateState().status, "available");
  assert.equal(fake.downloads, 0, "nothing downloads without opting in");
  assert.equal(fake.autoInstallOnAppQuit, false, "and nothing installs on quit");

  // Opting in to this one update downloads it and lets it install.
  await updater.download();
  assert.equal(updater.updateState().status, "ready");
  assert.equal(fake.downloads, 1);
  assert.equal(fake.autoInstallOnAppQuit, true);
});

test("turning auto-update on takes the update already on offer", async () => {
  await boot({ autoUpdate: false, available: "0.4.0" });
  assert.equal(updater.updateState().status, "available");
  const state = await updater.setAutoUpdate(true);
  assert.equal(state.autoUpdate, true);
  assert.equal(state.status, "ready");
  assert.equal(fake.downloads, 1);
  // And it is remembered for next launch.
  forgetSettings();
  const saved = JSON.parse(
    await fsp.readFile(path.join(home, "settings.json"), "utf8"),
  );
  assert.equal(saved.autoUpdate, true);
});

test("turning auto-update off stops a pending install the host didn't ask for", async () => {
  await boot({ autoUpdate: true, available: "0.4.0" });
  assert.equal(fake.autoInstallOnAppQuit, true);
  await updater.setAutoUpdate(false);
  assert.equal(
    fake.autoInstallOnAppQuit,
    false,
    "the downloaded update no longer installs by itself",
  );
  assert.equal(updater.updateState().status, "ready", "but it is still there to install");
});

test("an updater that declines to run says so instead of checking forever", async () => {
  // electron-updater returns null and emits nothing when it can't replace
  // this install — e.g. a Linux build started outside its AppImage.
  await boot({ autoUpdate: true, available: null });
  const state = updater.updateState();
  assert.equal(state.status, "unsupported");
  assert.equal(state.selfInstall, false, "so the UI offers the download page");
  assert.match(state.note ?? "", /can't update itself/);
  // Further checks are pointless and must not reset the message.
  await updater.check();
  assert.equal(updater.updateState().status, "unsupported");
});

test("a failed check surfaces the reason", async () => {
  await boot({ autoUpdate: true });
  fake.checkForUpdates = async () => {
    throw new Error("net::ERR_INTERNET_DISCONNECTED");
  };
  const state = await updater.check();
  assert.equal(state.status, "error");
  assert.match(state.note ?? "", /ERR_INTERNET_DISCONNECTED/);
  fake.checkForUpdates = FakeUpdater.prototype.checkForUpdates;
});

test("the releases page is the fallback everywhere", async () => {
  updater.openReleasesPage();
  assert.equal(opened, updater.RELEASES_URL);
});

test.after(async () => {
  await fsp.rm(home, { recursive: true, force: true });
});

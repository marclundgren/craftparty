import { app, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { readSettings, updateSettings } from "./settings.ts";

export const RELEASES_URL =
  "https://github.com/marclundgren/craftparty/releases/latest";

export type UpdateStatus =
  | "unsupported"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "ready"
  | "error";

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  /** Version on offer, once a check has found one. */
  latestVersion: string | null;
  /** 0–100 while downloading. */
  percent: number;
  autoUpdate: boolean;
  /**
   * Whether Craftparty can install the update itself. False means the
   * only honest option is sending the host to the download page.
   */
  selfInstall: boolean;
  /** Plain-language detail: why self-install is off, or what failed. */
  note: string | null;
}

/**
 * macOS is deliberately hands-off. Squirrel.Mac can only swap in an
 * update from a `zip` artifact whose code signature matches the running
 * app's, and Craftparty ships an unsigned `dmg` (see the release
 * workflow — no signing identities by decision). So on macOS the app
 * still *tells* you an update exists and opens the download page; it
 * never pretends it can install one. Windows (NSIS) and Linux
 * (AppImage) install fine unsigned.
 */
const SELF_INSTALL = process.platform !== "darwin";
const MAC_NOTE =
  "Automatic updates aren't available on macOS yet — Craftparty will open the download page instead.";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let state: UpdateState = {
  status: "unsupported",
  currentVersion: app.getVersion(),
  latestVersion: null,
  percent: 0,
  autoUpdate: true,
  selfInstall: SELF_INSTALL,
  note: null,
};

let onChange: (state: UpdateState) => void = () => {};
/**
 * True only when the host asked for *this* update by hand. An automatic
 * download must not set it, or switching automatic updates off later
 * would fail to call off the install it queued.
 */
let optedIn = false;

function set(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch };
  onChange(state);
}

export function updateState(): UpdateState {
  return state;
}

/**
 * Wire up the updater. Never throws: a machine that can't reach GitHub,
 * or a dev run with no update feed, just leaves the app on its current
 * version instead of blocking anything.
 */
export async function initUpdater(
  listener: (state: UpdateState) => void,
): Promise<void> {
  onChange = listener;
  const { autoUpdate } = await readSettings();

  // Downloads are always driven explicitly here so the preference is the
  // only thing that decides whether bytes move.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = autoUpdate;
  optedIn = false;

  if (!app.isPackaged) {
    set({
      autoUpdate,
      status: "unsupported",
      note: "Updates are delivered to the installed app; this is a development build.",
    });
    return;
  }

  autoUpdater.on("checking-for-update", () => set({ status: "checking" }));
  autoUpdater.on("update-not-available", () =>
    set({ status: "current", latestVersion: null, note: null }),
  );
  autoUpdater.on("update-available", (info) => {
    set({
      status: "available",
      latestVersion: info.version,
      note: SELF_INSTALL ? null : MAC_NOTE,
    });
    if (state.autoUpdate && SELF_INSTALL) void fetchUpdate(false);
  });
  autoUpdater.on("download-progress", (progress) =>
    set({ status: "downloading", percent: Math.round(progress.percent) }),
  );
  autoUpdater.on("update-downloaded", (info) =>
    set({
      status: "ready",
      latestVersion: info.version,
      percent: 100,
      note: null,
    }),
  );
  autoUpdater.on("error", (err) =>
    set({
      status: "error",
      note: err instanceof Error ? err.message : String(err),
    }),
  );

  set({ autoUpdate, status: "checking", note: SELF_INSTALL ? null : MAC_NOTE });
  await check();
  // Parties run for hours; a launcher left open should still notice a
  // release without being restarted first.
  setInterval(() => {
    if (state.status !== "downloading" && state.status !== "ready") void check();
  }, CHECK_INTERVAL_MS).unref();
}

/** Ask GitHub what the latest release is. Safe to call any time. */
export async function check(): Promise<UpdateState> {
  if (state.status === "unsupported") return state;
  try {
    const result = await autoUpdater.checkForUpdates();
    if (result === null) {
      // electron-updater declined to run and emitted no event — the
      // install isn't one it can replace (a Linux build started outside
      // its AppImage, say). Nothing is broken; this copy just can't
      // update itself, so point at the download page and stop checking.
      set({
        status: "unsupported",
        selfInstall: false,
        note: "This copy of Craftparty can't update itself — new versions are on the releases page.",
      });
    } else if (!result.isUpdateAvailable) {
      set({ status: "current", latestVersion: null, note: null });
    }
  } catch (err) {
    set({
      status: "error",
      note: err instanceof Error ? err.message : String(err),
    });
  }
  return state;
}

/** Fetch the update in the background; it installs when the app closes. */
export async function download(): Promise<UpdateState> {
  return fetchUpdate(true);
}

async function fetchUpdate(manual: boolean): Promise<UpdateState> {
  if (!SELF_INSTALL || state.status === "unsupported") return state;
  if (state.status === "downloading" || state.status === "ready") return state;
  if (manual) optedIn = true;
  // Asking for an update by hand is a deliberate act, so let it install
  // on the way out even with automatic updates switched off.
  autoUpdater.autoInstallOnAppQuit = manual || state.autoUpdate;
  try {
    set({ status: "downloading", percent: 0 });
    await autoUpdater.downloadUpdate();
  } catch (err) {
    set({
      status: "error",
      note: err instanceof Error ? err.message : String(err),
    });
  }
  return state;
}

/**
 * Restart into the new version now. The caller must make sure nothing is
 * running that would be killed by the restart — see main.ts.
 */
export function installNow(): void {
  autoUpdater.quitAndInstall();
}

export async function setAutoUpdate(on: boolean): Promise<UpdateState> {
  await updateSettings({ autoUpdate: on });
  set({ autoUpdate: on });
  // A downloaded update still installs on quit if it was asked for
  // explicitly; otherwise switching off means nothing happens by itself.
  autoUpdater.autoInstallOnAppQuit = on || optedIn;
  if (on && state.status === "available" && SELF_INSTALL) await fetchUpdate(false);
  else if (on && state.status === "current") await check();
  return state;
}

export function openReleasesPage(): void {
  void shell.openExternal(RELEASES_URL);
}

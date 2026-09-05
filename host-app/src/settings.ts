import fsp from "node:fs/promises";
import path from "node:path";
import { dataDir } from "../../host-engine/src/platform.ts";

/**
 * Small preferences file next to the worlds, at <dataDir>/settings.json.
 * Everything here has a working default, so a missing or corrupt file is
 * never an error — it just means "the defaults".
 */
export interface Settings {
  /**
   * Download updates in the background and install them when the app
   * next closes, so the next launch is the new version. Off means the
   * host is told an update exists and chooses when to take it.
   */
  autoUpdate: boolean;
}

const DEFAULTS: Settings = { autoUpdate: true };

const settingsFile = () => path.join(dataDir(), "settings.json");

let cache: Settings | null = null;

/** Only known keys of the right type survive — the file is user-editable. */
function sanitize(raw: Partial<Settings> | null): Partial<Settings> {
  if (!raw || typeof raw !== "object") return {};
  return typeof raw.autoUpdate === "boolean"
    ? { autoUpdate: raw.autoUpdate }
    : {};
}

export async function readSettings(): Promise<Settings> {
  if (cache) return cache;
  try {
    const raw = JSON.parse(await fsp.readFile(settingsFile(), "utf8"));
    cache = { ...DEFAULTS, ...sanitize(raw) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export async function updateSettings(
  patch: Partial<Settings>,
): Promise<Settings> {
  const next = { ...(await readSettings()), ...sanitize(patch) };
  cache = next;
  await fsp.mkdir(dataDir(), { recursive: true });
  await fsp.writeFile(settingsFile(), JSON.stringify(next, null, 2) + "\n");
  return next;
}

/** Tests only: drop the in-memory copy so the next read hits disk. */
export function forgetSettings(): void {
  cache = null;
}

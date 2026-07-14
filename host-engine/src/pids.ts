import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ChildProcess } from "node:child_process";
import { dataDir } from "./platform.ts";

const execFileAsync = promisify(execFile);

const runDir = () => path.join(dataDir(), "run");

interface PidRecord {
  pid: number;
  /** Substring of the child's command line, used to verify identity. */
  match: string;
  /** The app process that owns this child; children of a LIVE app are never reaped. */
  ownerPid: number;
  startedAt: string;
}

/**
 * Track an engine child so a crashed/killed app can't orphan it: write a
 * pidfile now, remove it on clean exit. reapStaleChildren() on the next
 * app start kills anything whose pidfile survived.
 */
export function trackChild(
  label: string,
  proc: ChildProcess,
  match: string,
): void {
  if (!proc.pid) return;
  const file = path.join(
    runDir(),
    `${label.toLowerCase().replace(/[^a-z0-9-]/g, "-")}-${proc.pid}.json`,
  );
  fs.mkdirSync(runDir(), { recursive: true });
  const record: PidRecord = {
    pid: proc.pid,
    match,
    ownerPid: process.pid,
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(record));
  proc.once("exit", () => {
    fs.rmSync(file, { force: true });
  });
}

/** Kill children left behind by a previous app instance that died hard. */
export async function reapStaleChildren(): Promise<string[]> {
  const reaped: string[] = [];
  let files: string[];
  try {
    files = await fsp.readdir(runDir());
  } catch {
    return reaped;
  }
  for (const name of files) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(runDir(), name);
    try {
      const record = JSON.parse(await fsp.readFile(file, "utf8")) as PidRecord;
      if (record.ownerPid && (await commandOf(record.ownerPid)) !== null) {
        continue; // owning app instance is alive — not ours to reap
      }
      const cmd = await commandOf(record.pid);
      if (cmd && cmd.includes(record.match)) {
        process.kill(record.pid, "SIGKILL");
        reaped.push(`${name} (pid ${record.pid})`);
      }
    } catch {
      // unreadable/racing — fall through to cleanup
    }
    await fsp.rm(file, { force: true });
  }
  return reaped;
}

/** Command line of a live process, or null; never kills on a reused pid. */
async function commandOf(pid: number): Promise<string | null> {
  try {
    process.kill(pid, 0);
  } catch {
    return null; // not running
  }
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-Command",
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
      ]);
      return stdout.trim() || null;
    }
    const { stdout } = await execFileAsync("ps", [
      "-p",
      String(pid),
      "-o",
      "command=",
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

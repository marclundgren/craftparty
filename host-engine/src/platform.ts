import os from "node:os";
import path from "node:path";

export interface Platform {
  /** Adoptium naming */
  os: "linux" | "windows" | "mac";
  arch: "x64" | "aarch64";
}

export function currentPlatform(): Platform {
  const osName =
    process.platform === "win32"
      ? "windows"
      : process.platform === "darwin"
        ? "mac"
        : "linux";
  const arch = process.arch === "arm64" ? "aarch64" : "x64";
  return { os: osName, arch };
}

/** Root directory for everything Craftparty stores on the host machine. */
export function dataDir(): string {
  return (
    process.env.CRAFTPARTY_HOME ?? path.join(os.homedir(), ".craftparty")
  );
}

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { downloadFile } from "./download.ts";
import { resolveJre } from "./versions.ts";
import { currentPlatform, dataDir } from "./platform.ts";

const execFileAsync = promisify(execFile);

export interface Jre {
  javaPath: string;
  releaseName: string;
  featureVersion: number;
}

/**
 * Ensure a Temurin JRE is present under <dataDir>/runtime and return the
 * path to its java executable. Downloads + extracts on first run.
 */
export async function ensureJre(
  onProgress?: (received: number, total: number | null) => void,
): Promise<Jre> {
  const platform = currentPlatform();
  const asset = await resolveJre(platform);
  const runtimeDir = path.join(dataDir(), "runtime");
  const installDir = path.join(runtimeDir, asset.releaseName);
  const javaName = platform.os === "windows" ? "java.exe" : "java";

  const existing = findJava(installDir, javaName);
  if (existing) {
    return {
      javaPath: existing,
      releaseName: asset.releaseName,
      featureVersion: asset.featureVersion,
    };
  }

  const archive = path.join(
    runtimeDir,
    `${asset.releaseName}.${asset.archiveType}`,
  );
  await downloadFile(asset.url, archive, {
    sha256: asset.sha256,
    onProgress,
  });

  await fsp.mkdir(installDir, { recursive: true });
  if (asset.archiveType === "tar.gz") {
    await execFileAsync("tar", ["-xzf", archive, "-C", installDir]);
  } else {
    // Windows: PowerShell ships everywhere; avoids a zip dependency.
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -Path '${archive}' -DestinationPath '${installDir}' -Force`,
    ]);
  }
  await fsp.rm(archive, { force: true });

  const javaPath = findJava(installDir, javaName);
  if (!javaPath) {
    throw new Error(`Extracted JRE but no ${javaName} found in ${installDir}`);
  }
  return {
    javaPath,
    releaseName: asset.releaseName,
    featureVersion: asset.featureVersion,
  };
}

/** The archive contains a versioned top-level dir; search two levels deep. */
function findJava(installDir: string, javaName: string): string | null {
  const direct = path.join(installDir, "bin", javaName);
  if (fs.existsSync(direct)) return direct;
  if (!fs.existsSync(installDir)) return null;
  for (const entry of fs.readdirSync(installDir)) {
    const nested = path.join(installDir, entry, "bin", javaName);
    if (fs.existsSync(nested)) return nested;
    // macOS archives nest under Contents/Home
    const mac = path.join(installDir, entry, "Contents", "Home", "bin", javaName);
    if (fs.existsSync(mac)) return mac;
  }
  return null;
}

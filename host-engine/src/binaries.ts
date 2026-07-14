import fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { downloadFile, fetchJson } from "./download.ts";
import { currentPlatform, dataDir } from "./platform.ts";

const execFileAsync = promisify(execFile);

export interface TailscaleBins {
  tailscale: string;
  tailscaled: string;
  version: string;
}

interface PkgsIndex {
  TarballsVersion: string;
  Tarballs: Record<string, string>;
  MSIsVersion: string;
  MSIs: Record<string, string>;
  MacZipsVersion: string;
  MacZips: Record<string, string>;
}

/**
 * Ensure tailscale + tailscaled binaries are present for this platform,
 * fetched from pkgs.tailscale.com and cached under ~/.craftparty/vpn.
 * Linux: static tarball (runtime-verified). Windows: administrative MSI
 * extraction, no admin rights needed. macOS: standalone app zip.
 * (Windows/macOS paths are implemented but not yet runtime-verified.)
 */
export async function ensureTailscale(): Promise<TailscaleBins> {
  const platform = currentPlatform();
  const index = await fetchJson<PkgsIndex>(
    "https://pkgs.tailscale.com/stable/?mode=json",
  );

  if (platform.os === "linux") {
    const arch = platform.arch === "aarch64" ? "arm64" : "amd64";
    const tarball = index.Tarballs[arch];
    if (!tarball) throw new Error(`No tailscale tarball for ${arch}`);
    const version = index.TarballsVersion;
    const dir = path.join(dataDir(), "vpn", "tailscale", version);
    const bins = {
      tailscale: path.join(dir, "tailscale"),
      tailscaled: path.join(dir, "tailscaled"),
      version,
    };
    if (fs.existsSync(bins.tailscale) && fs.existsSync(bins.tailscaled)) {
      return bins;
    }
    const archive = path.join(dataDir(), "vpn", "tailscale", tarball);
    await downloadFile(`https://pkgs.tailscale.com/stable/${tarball}`, archive);
    await fsp.mkdir(dir, { recursive: true });
    await execFileAsync("tar", [
      "-xzf",
      archive,
      "-C",
      dir,
      "--strip-components=1",
    ]);
    await fsp.rm(archive, { force: true });
    if (!fs.existsSync(bins.tailscale) || !fs.existsSync(bins.tailscaled)) {
      throw new Error(
        `tailscale tarball did not contain expected binaries (${dir})`,
      );
    }
    return bins;
  }

  if (platform.os === "windows") {
    const arch = platform.arch === "aarch64" ? "arm64" : "amd64";
    const msi = index.MSIs[arch];
    if (!msi) throw new Error(`No tailscale MSI for ${arch}`);
    const version = index.MSIsVersion;
    const dir = path.join(dataDir(), "vpn", "tailscale", version);
    const found = () => ({
      tailscale: findFileRecursive(dir, "tailscale.exe"),
      tailscaled: findFileRecursive(dir, "tailscaled.exe"),
    });
    let bins = found();
    if (!bins.tailscale || !bins.tailscaled) {
      const archive = path.join(dataDir(), "vpn", "tailscale", msi);
      await downloadFile(`https://pkgs.tailscale.com/stable/${msi}`, archive);
      await fsp.mkdir(dir, { recursive: true });
      // Administrative image extraction — unpacks files, needs no admin.
      await execFileAsync("msiexec.exe", [
        "/a",
        archive,
        `TARGETDIR=${dir}`,
        "/qn",
      ]);
      await fsp.rm(archive, { force: true });
      bins = found();
    }
    if (!bins.tailscale || !bins.tailscaled) {
      throw new Error(`MSI extraction did not yield tailscale binaries (${dir})`);
    }
    return { tailscale: bins.tailscale, tailscaled: bins.tailscaled, version };
  }

  // macOS: the standalone app zip contains the CLI and daemon.
  const zip = index.MacZips["universal"];
  if (!zip) throw new Error("No standalone tailscale mac zip in index");
  const version = index.MacZipsVersion;
  const dir = path.join(dataDir(), "vpn", "tailscale", version);
  const found = () => ({
    tailscale: findFileRecursive(dir, "Tailscale"),
    tailscaled: findFileRecursive(dir, "tailscaled"),
  });
  let bins = found();
  if (!bins.tailscale || !bins.tailscaled) {
    const archive = path.join(dataDir(), "vpn", "tailscale", zip);
    await downloadFile(`https://pkgs.tailscale.com/stable/${zip}`, archive);
    await fsp.mkdir(dir, { recursive: true });
    await execFileAsync("unzip", ["-oq", archive, "-d", dir]);
    await fsp.rm(archive, { force: true });
    bins = found();
  }
  if (!bins.tailscale || !bins.tailscaled) {
    throw new Error(`Mac zip did not yield tailscale binaries (${dir})`);
  }
  return { tailscale: bins.tailscale, tailscaled: bins.tailscaled, version };
}

function findFileRecursive(root: string, name: string): string | null {
  if (!fs.existsSync(root)) return null;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === name) return full;
    }
  }
  return null;
}

/** Ensure the headscale single binary is present (GitHub releases). */
export async function ensureHeadscale(): Promise<{
  headscale: string;
  version: string;
}> {
  const platform = currentPlatform();
  const osName = platform.os === "mac" ? "darwin" : platform.os;
  const arch = platform.arch === "aarch64" ? "arm64" : "amd64";

  const release = await fetchJson<{
    tag_name: string;
    assets: Array<{ name: string; browser_download_url: string }>;
  }>("https://api.github.com/repos/juanfont/headscale/releases/latest");

  const suffix = `${osName}_${arch}${platform.os === "windows" ? ".exe" : ""}`;
  const asset = release.assets.find((a) => a.name.endsWith(suffix));
  if (!asset) {
    throw new Error(
      `No headscale ${release.tag_name} asset for ${suffix} (assets: ${release.assets.map((a) => a.name).join(", ")})`,
    );
  }

  const bin = path.join(
    dataDir(),
    "vpn",
    "headscale",
    `headscale-${release.tag_name}${platform.os === "windows" ? ".exe" : ""}`,
  );
  if (!fs.existsSync(bin)) {
    await downloadFile(asset.browser_download_url, bin);
    await fsp.chmod(bin, 0o755);
  }
  return { headscale: bin, version: release.tag_name };
}

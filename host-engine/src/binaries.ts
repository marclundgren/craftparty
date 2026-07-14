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

/**
 * Ensure tailscale + tailscaled static binaries are present.
 * Linux is implemented (static tarballs from pkgs.tailscale.com);
 * Windows/macOS bundling comes with the packaged desktop app.
 */
export async function ensureTailscale(): Promise<TailscaleBins> {
  const platform = currentPlatform();
  if (platform.os !== "linux") {
    throw new Error(
      `tailscale bundling not implemented for ${platform.os} yet (linux only so far)`,
    );
  }
  const arch = platform.arch === "aarch64" ? "arm64" : "amd64";
  const index = await fetchJson<{
    TarballsVersion: string;
    Tarballs: Record<string, string>;
  }>("https://pkgs.tailscale.com/stable/?mode=json");
  const tarball = index.Tarballs[arch];
  if (!tarball) throw new Error(`No tailscale tarball for ${arch}`);

  const version = index.TarballsVersion ?? tarball;
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
    throw new Error(`tailscale tarball did not contain expected binaries (${dir})`);
  }
  return bins;
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

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface DownloadOptions {
  sha256?: string;
  onProgress?: (receivedBytes: number, totalBytes: number | null) => void;
  timeoutMs?: number;
}

/**
 * Download url to dest atomically (via dest.part), optionally verifying a
 * sha256 checksum. Skips the download when dest already exists and matches
 * the checksum (or exists at all, when no checksum is given).
 */
export async function downloadFile(
  url: string,
  dest: string,
  opts: DownloadOptions = {},
): Promise<void> {
  if (fs.existsSync(dest)) {
    if (!opts.sha256 || (await fileSha256(dest)) === opts.sha256) return;
    await fsp.rm(dest);
  }

  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(opts.timeoutMs ?? 10 * 60_000),
    headers: { "User-Agent": "craftparty-host-engine" },
    redirect: "follow",
  });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: HTTP ${res.status} for ${url}`);
  }

  const total = Number(res.headers.get("content-length")) || null;
  let received = 0;
  const body = Readable.fromWeb(res.body as never);
  body.on("data", (chunk: Buffer) => {
    received += chunk.length;
    opts.onProgress?.(received, total);
  });
  await pipeline(body, fs.createWriteStream(part));

  if (opts.sha256) {
    const actual = await fileSha256(part);
    if (actual !== opts.sha256) {
      await fsp.rm(part, { force: true });
      throw new Error(
        `Checksum mismatch for ${url}\n  expected ${opts.sha256}\n  actual   ${actual}`,
      );
    }
  }
  await fsp.rename(part, dest);
}

export async function fileSha256(file: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest("hex");
}

export async function fetchJson<T>(url: string, timeoutMs = 15_000): Promise<T> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": "craftparty-host-engine" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

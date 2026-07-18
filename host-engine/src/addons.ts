import fsp from "node:fs/promises";
import path from "node:path";
import { downloadFile } from "./download.ts";

export interface AddonJarRef {
  filename: string;
  url: string;
}

/**
 * Make the world's mods folder match the selected addons. Only files
 * recorded in our manifest are ever removed — jars a power user dropped
 * in by hand are left alone.
 */
export async function syncAddons(
  worldDir: string,
  jars: AddonJarRef[],
  onLog?: (line: string) => void,
): Promise<void> {
  const modsDir = path.join(worldDir, "mods");
  const manifestPath = path.join(modsDir, ".craftparty-addons.json");
  await fsp.mkdir(modsDir, { recursive: true });

  let managed: string[] = [];
  try {
    managed = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
  } catch {
    // no manifest yet
  }

  const wanted = new Map(jars.map((jar) => [jar.filename, jar.url]));
  for (const filename of managed) {
    if (!wanted.has(filename)) {
      await fsp.rm(path.join(modsDir, filename), { force: true });
      onLog?.(`addons: removed ${filename}`);
    }
  }
  for (const [filename, url] of wanted) {
    const dest = path.join(modsDir, filename);
    try {
      await fsp.access(dest);
    } catch {
      onLog?.(`addons: downloading ${filename}`);
      await downloadFile(url, dest);
    }
  }
  await fsp.writeFile(manifestPath, JSON.stringify([...wanted.keys()]));
}

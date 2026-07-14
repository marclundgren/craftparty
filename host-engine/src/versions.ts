import { fetchJson } from "./download.ts";
import type { Platform } from "./platform.ts";

const FABRIC_META = "https://meta.fabricmc.net/v2";
const ADOPTIUM = "https://api.adoptium.net/v3";

export interface FabricServer {
  minecraft: string;
  loader: string;
  installer: string;
  /** Direct download URL of a ready-to-run server launcher jar. */
  serverJarUrl: string;
}

export async function resolveLatestFabricServer(): Promise<FabricServer> {
  const games =
    await fetchJson<Array<{ version: string; stable: boolean }>>(
      `${FABRIC_META}/versions/game`,
    );
  const minecraft = games.find((g) => g.stable)?.version;
  if (!minecraft) throw new Error("No stable Minecraft version from Fabric meta");

  const loaders = await fetchJson<
    Array<{ loader: { version: string; stable: boolean } }>
  >(`${FABRIC_META}/versions/loader/${minecraft}`);
  const loader =
    loaders.find((l) => l.loader.stable)?.loader.version ??
    loaders[0]?.loader.version;
  if (!loader) throw new Error(`No Fabric loader for Minecraft ${minecraft}`);

  const installers = await fetchJson<
    Array<{ version: string; stable: boolean }>
  >(`${FABRIC_META}/versions/installer`);
  const installer = installers.find((i) => i.stable)?.version;
  if (!installer) throw new Error("No stable Fabric installer version");

  return {
    minecraft,
    loader,
    installer,
    serverJarUrl: `${FABRIC_META}/versions/loader/${minecraft}/${loader}/${installer}/server/jar`,
  };
}

export interface JreAsset {
  featureVersion: number;
  releaseName: string;
  url: string;
  sha256: string;
  archiveType: string;
}

/**
 * Resolve a Temurin JRE for this platform. Tries the preferred Java feature
 * versions in order (current Minecraft needs 25; older fall back to 21).
 */
export async function resolveJre(
  platform: Platform,
  preferred: number[] = [25, 21],
): Promise<JreAsset> {
  for (const feature of preferred) {
    const url =
      `${ADOPTIUM}/assets/latest/${feature}/hotspot` +
      `?os=${platform.os}&architecture=${platform.arch}&image_type=jre&vendor=eclipse`;
    try {
      const assets = await fetchJson<
        Array<{
          release_name: string;
          binary: {
            package: { link: string; checksum: string; name: string };
          };
        }>
      >(url);
      const asset = assets[0];
      if (!asset) continue;
      return {
        featureVersion: feature,
        releaseName: asset.release_name,
        url: asset.binary.package.link,
        sha256: asset.binary.package.checksum,
        archiveType: asset.binary.package.name.endsWith(".zip")
          ? "zip"
          : "tar.gz",
      };
    } catch {
      // try the next feature version
    }
  }
  throw new Error(
    `No Temurin JRE found for ${platform.os}/${platform.arch} (tried Java ${preferred.join(", ")})`,
  );
}

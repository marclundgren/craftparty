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

/**
 * Fabric's meta API is the source of truth for which Minecraft versions
 * Craftparty can actually host: a version is hostable once Fabric has
 * published both intermediary mappings (which is what puts it in
 * /versions/game) and a loader for it. Mojang ships a release before
 * that happens, so "the latest Minecraft" and "the latest Minecraft we
 * can serve" are the same number most of the time and a few days apart
 * the rest of the time. Everything here asks Fabric, never Mojang, so
 * the app never promises a version it can't start.
 */

/** How far down the stable list to look for one Fabric can serve. */
const LOOKBACK = 5;

/** A seam for tests; production always uses the real fetchJson. */
type FetchJson = <T>(url: string) => Promise<T>;

interface GameVersion {
  version: string;
  stable: boolean;
}

interface LoaderVersion {
  loader: { version: string; stable: boolean };
}

/**
 * Resolve a runnable Fabric server.
 *
 * With a version, that exact one — a world stays on the Minecraft it was
 * made with, and being handed a version means the caller has already
 * decided. Without one, the newest stable release Fabric can serve
 * today: normally the first entry, and during the gap after a Minecraft
 * release the newest that already has a loader.
 */
export async function resolveFabricServer(
  minecraft?: string | null,
  json: FetchJson = fetchJson,
): Promise<FabricServer> {
  const installers = await json<Array<{ version: string; stable: boolean }>>(
    `${FABRIC_META}/versions/installer`,
  );
  const installer = installers.find((i) => i.stable)?.version;
  if (!installer) throw new Error("No stable Fabric installer version");

  if (minecraft) {
    const loader = await loaderFor(minecraft, json);
    if (!loader) {
      throw new Error(
        `Fabric has no server for Minecraft ${minecraft} — this world can't start until it does.`,
      );
    }
    return build(minecraft, loader, installer);
  }

  const games = await json<GameVersion[]>(`${FABRIC_META}/versions/game`);
  const stable = games.filter((g) => g.stable).slice(0, LOOKBACK);
  if (stable.length === 0) {
    throw new Error("No stable Minecraft version from Fabric meta");
  }
  for (const game of stable) {
    // Fabric publishes intermediary before the loader that uses it, so a
    // version can be listed here minutes or days before it can be run.
    // Walking down means a Minecraft release day costs the newest
    // version, not the ability to host at all.
    const loader = await loaderFor(game.version, json);
    if (loader) return build(game.version, loader, installer);
  }
  throw new Error(
    `Fabric has no loader yet for Minecraft ${stable.map((g) => g.version).join(", ")}`,
  );
}

/** The newest loader for this Minecraft, or null if there is none yet. */
async function loaderFor(
  minecraft: string,
  json: FetchJson,
): Promise<string | null> {
  let loaders: LoaderVersion[];
  try {
    // A version Fabric can't build for answers 400, which fetchJson
    // throws on — the same answer as an empty list, and treated the same.
    loaders = await json<LoaderVersion[]>(
      `${FABRIC_META}/versions/loader/${encodeURIComponent(minecraft)}`,
    );
  } catch {
    return null;
  }
  return (
    loaders.find((l) => l.loader.stable)?.loader.version ??
    loaders[0]?.loader.version ??
    null
  );
}

function build(
  minecraft: string,
  loader: string,
  installer: string,
): FabricServer {
  return {
    minecraft,
    loader,
    installer,
    serverJarUrl: `${FABRIC_META}/versions/loader/${minecraft}/${loader}/${installer}/server/jar`,
  };
}

/**
 * The newest hostable Minecraft, cached briefly. The host form asks for
 * this to say what a new world will run, and the start that follows asks
 * again moments later — one answer serves both, and a stale cache costs
 * at most a version that landed in the last few minutes.
 */
const LATEST_TTL_MS = 10 * 60_000;
let latest: { at: number; server: FabricServer } | null = null;

export async function resolveLatestFabricServer(): Promise<FabricServer> {
  if (latest && Date.now() - latest.at < LATEST_TTL_MS) return latest.server;
  const server = await resolveFabricServer();
  latest = { at: Date.now(), server };
  return server;
}

/** Just the version string, for the UI. */
export async function latestSupportedMinecraft(): Promise<string> {
  return (await resolveLatestFabricServer()).minecraft;
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

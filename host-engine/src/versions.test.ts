import test from "node:test";
import assert from "node:assert/strict";
import { resolveFabricServer } from "./versions.ts";

/**
 * A stand-in for Fabric's meta API: a list of game versions, and which of
 * them a loader has actually been published for. Those two are not the
 * same set — the gap between them is the whole reason this code walks.
 */
function fabric(
  games: Array<[version: string, stable: boolean]>,
  loaders: Record<string, Array<[version: string, stable: boolean]>>,
) {
  const urls: string[] = [];
  const json = async <T>(url: string): Promise<T> => {
    urls.push(url);
    if (url.endsWith("/versions/installer")) {
      return [
        { version: "1.1.3", stable: false },
        { version: "1.1.2", stable: true },
      ] as T;
    }
    if (url.endsWith("/versions/game")) {
      return games.map(([version, stable]) => ({ version, stable })) as T;
    }
    const asked = /\/versions\/loader\/([^/]+)$/.exec(url);
    if (!asked) throw new Error(`unexpected url ${url}`);
    const found = loaders[decodeURIComponent(asked[1])];
    // Fabric answers 400 for a version it can't build for, and fetchJson
    // turns any non-2xx into a throw.
    if (!found) throw new Error(`HTTP 400 for ${url}`);
    return found.map(([version, stable]) => ({ loader: { version, stable } })) as T;
  };
  return { json, urls };
}

test("the default is the newest stable Minecraft Fabric can serve", async () => {
  const { json } = fabric(
    [
      ["26.3-pre-1", false],
      ["26.2", true],
      ["26.1", true],
    ],
    { "26.2": [["0.19.5", true]], "26.1": [["0.19.4", true]] },
  );
  const server = await resolveFabricServer(null, json);
  assert.equal(server.minecraft, "26.2");
  assert.equal(server.loader, "0.19.5");
  assert.equal(server.installer, "1.1.2");
  assert.equal(
    server.serverJarUrl,
    "https://meta.fabricmc.net/v2/versions/loader/26.2/0.19.5/1.1.2/server/jar",
  );
});

test("a Minecraft release Fabric hasn't caught up with is skipped", async () => {
  // Release day: intermediary is out (so 26.3 is listed and stable) but no
  // loader uses it yet. Hosting has to keep working on yesterday's version
  // rather than promising one that can't start.
  const { json } = fabric(
    [
      ["26.3", true],
      ["26.2", true],
      ["26.1", true],
    ],
    { "26.2": [["0.19.5", true]], "26.1": [["0.19.4", true]] },
  );
  const server = await resolveFabricServer(null, json);
  assert.equal(server.minecraft, "26.2");
});

test("snapshots and pre-releases are never picked", async () => {
  const { json } = fabric(
    [
      ["26.3-pre-2", false],
      ["26.3-snapshot-9", false],
      ["26.2", true],
    ],
    {
      "26.3-pre-2": [["0.19.6", true]],
      "26.3-snapshot-9": [["0.19.6", true]],
      "26.2": [["0.19.5", true]],
    },
  );
  assert.equal((await resolveFabricServer(null, json)).minecraft, "26.2");
});

test("a stable loader beats a newer unstable one", async () => {
  const { json } = fabric([["26.2", true]], {
    "26.2": [
      ["0.20.0-beta.1", false],
      ["0.19.5", true],
    ],
  });
  assert.equal((await resolveFabricServer(null, json)).loader, "0.19.5");
});

test("an unstable loader is better than no server at all", async () => {
  const { json } = fabric([["26.2", true]], {
    "26.2": [["0.20.0-beta.1", false]],
  });
  assert.equal((await resolveFabricServer(null, json)).loader, "0.20.0-beta.1");
});

test("a world's own version is resolved exactly, not the newest", async () => {
  const { json, urls } = fabric(
    [
      ["26.2", true],
      ["26.1", true],
    ],
    { "26.2": [["0.19.5", true]], "26.1": [["0.19.4", true]] },
  );
  const server = await resolveFabricServer("26.1", json);
  assert.equal(server.minecraft, "26.1");
  assert.equal(server.loader, "0.19.4");
  // Asking what's newest would be pointless here, and a wrong answer
  // would be worse than no answer.
  assert.ok(!urls.some((u) => u.endsWith("/versions/game")));
});

test("a version Fabric can't serve says so instead of quietly moving on", async () => {
  const { json } = fabric([["26.2", true]], { "26.2": [["0.19.5", true]] });
  await assert.rejects(
    () => resolveFabricServer("0.30", json),
    /no server for Minecraft 0\.30/,
  );
});

test("nothing serveable at all is an error, not a snapshot", async () => {
  const { json } = fabric(
    [
      ["26.3", true],
      ["26.2", true],
    ],
    {},
  );
  await assert.rejects(
    () => resolveFabricServer(null, json),
    /no loader yet for Minecraft 26\.3, 26\.2/,
  );
});

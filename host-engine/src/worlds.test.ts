import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

// worlds.ts resolves the data dir at call time from CRAFTPARTY_HOME, so
// point it at a scratch directory before importing anything.
const home = await fsp.mkdtemp(path.join(os.tmpdir(), "craftparty-worlds-"));
process.env.CRAFTPARTY_HOME = home;

const {
  createWorld,
  deleteWorld,
  ensureWorld,
  getWorld,
  listWorlds,
  recordPlayed,
  worldExists,
  worldId,
  worldsDir,
} = await import("./worlds.ts");

test("worldId collapses names to one directory", () => {
  assert.equal(worldId("Dragon Cave"), "dragon-cave");
  assert.equal(worldId("  dragon   cave  "), "dragon-cave");
  assert.equal(worldId("Dragon Cave!"), "dragon-cave");
  assert.throws(() => worldId("   "), /not usable/);
  assert.throws(() => worldId("🐉"), /not usable/);
});

test("a world survives being created and reopened", async () => {
  const created = await createWorld("Dragon Cave");
  assert.equal(created.id, "dragon-cave");
  assert.equal(created.name, "Dragon Cave");
  assert.equal(created.lastPlayedAt, null);

  const reopened = await getWorld("dragon-cave");
  assert.equal(reopened.name, "Dragon Cave");
  assert.equal(reopened.dir, path.join(worldsDir(), "dragon-cave"));
});

test("creating a world twice refuses rather than reusing the save", async () => {
  await createWorld("Sky Base");
  await assert.rejects(() => createWorld("sky base!"), /already have a world/);
  // ensureWorld is the explicit "resume or create" path.
  const same = await ensureWorld("Sky Base");
  assert.equal(same.id, "sky-base");
});

test("playing a world stamps it and remembers its addons", async () => {
  await createWorld("Mine Town");
  await recordPlayed("mine-town", ["welcome-party"]);
  const world = await getWorld("mine-town");
  assert.ok(world.lastPlayedAt);
  assert.deepEqual(world.addonIds, ["welcome-party"]);
  // The name the host typed survives the update.
  assert.equal(world.name, "Mine Town");
});

test("listWorlds includes worlds saved before metadata existed", async () => {
  await fsp.mkdir(path.join(worldsDir(), "old-world"), { recursive: true });
  const worlds = await listWorlds();
  const legacy = worlds.find((w) => w.id === "old-world");
  assert.ok(legacy, "a bare world directory is still a world");
  assert.equal(legacy.name, "old-world");
  assert.ok(legacy.lastPlayedAt, "falls back to the directory's mtime");
  assert.equal(legacy.minecraftVersion, null, "nothing to claim about it");
});

test("listWorlds reports size and sorts most recently played first", async () => {
  const world = await createWorld("Big World");
  await fsp.writeFile(path.join(world.dir, "level.dat"), "x".repeat(4096));
  await recordPlayed(world.id, []);
  const worlds = await listWorlds();
  assert.equal(worlds[0].id, "big-world", "just played, so it leads the list");
  assert.ok(worlds[0].sizeBytes >= 4096);
});

test("a world keeps the Minecraft version it was made on", async () => {
  const world = await createWorld("Pinned", "26.2");
  assert.equal(world.minecraftVersion, "26.2");
  assert.equal((await getWorld(world.id)).minecraftVersion, "26.2");

  // A later run on a newer Minecraft must not move the save forward: the
  // upgrade is one-way, and the host never asked for it.
  await recordPlayed(world.id, [], "26.3");
  assert.equal((await getWorld(world.id)).minecraftVersion, "26.2");
});

test("a world with no version yet is stamped the first time it runs", async () => {
  // Created while Fabric was unreachable, or saved before versions were
  // recorded at all — either way the first successful host settles it.
  const world = await createWorld("Unpinned");
  assert.equal(world.minecraftVersion, null);
  await recordPlayed(world.id, ["welcome-party"], "26.2");
  const played = await getWorld(world.id);
  assert.equal(played.minecraftVersion, "26.2");
  assert.deepEqual(played.addonIds, ["welcome-party"]);
});

test("a world from before versions were recorded is read from its save", async () => {
  // The case that matters most: worlds that already exist on a host's
  // machine. Nothing is written down for them, so the save itself has to
  // answer — otherwise continuing one is a coin flip on whether it gets
  // upgraded.
  const world = await createWorld("Older World");
  const save = path.join(world.dir, "world");
  await fsp.mkdir(save, { recursive: true });
  await fsp.writeFile(path.join(save, "level.dat"), levelDat("26.1"));

  assert.equal((await getWorld(world.id)).minecraftVersion, "26.1");
  const listed = (await listWorlds()).find((w) => w.id === world.id);
  assert.equal(listed?.minecraftVersion, "26.1");
});

test("deleting a world removes it for good", async () => {
  await createWorld("Doomed");
  assert.equal(await worldExists("doomed"), true);
  await deleteWorld("doomed");
  assert.equal(await worldExists("doomed"), false);
  await assert.rejects(() => getWorld("doomed"), /gone/);
});

test("ids that escape the worlds directory are refused", async () => {
  for (const bad of ["..", "../escape", "a/b", "/etc", ".hidden", ""]) {
    await assert.rejects(
      () => deleteWorld(bad),
      /not a valid world id/i,
      `deleteWorld(${JSON.stringify(bad)}) must refuse`,
    );
  }
  // The worlds directory itself is still there.
  assert.ok((await fsp.stat(worldsDir())).isDirectory());
});

/** A gzipped level.dat carrying just the version stamp. */
function levelDat(version: string): Buffer {
  const str = (s: string) => {
    const body = Buffer.from(s, "utf8");
    const len = Buffer.alloc(2);
    len.writeUInt16BE(body.length);
    return Buffer.concat([len, body]);
  };
  const compound = (name: string, ...fields: Buffer[]) =>
    Buffer.concat([Buffer.from([10]), str(name), ...fields, Buffer.from([0])]);
  return zlib.gzipSync(
    compound(
      "",
      compound(
        "Data",
        compound(
          "Version",
          Buffer.concat([Buffer.from([8]), str("Name"), str(version)]),
        ),
      ),
    ),
  );
}

test.after(async () => {
  await fsp.rm(home, { recursive: true, force: true });
});

import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
});

test("listWorlds reports size and sorts most recently played first", async () => {
  const world = await createWorld("Big World");
  await fsp.writeFile(path.join(world.dir, "level.dat"), "x".repeat(4096));
  await recordPlayed(world.id, []);
  const worlds = await listWorlds();
  assert.equal(worlds[0].id, "big-world", "just played, so it leads the list");
  assert.ok(worlds[0].sizeBytes >= 4096);
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

test.after(async () => {
  await fsp.rm(home, { recursive: true, force: true });
});

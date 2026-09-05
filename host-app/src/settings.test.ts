import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const home = await fsp.mkdtemp(path.join(os.tmpdir(), "craftparty-settings-"));
process.env.CRAFTPARTY_HOME = home;

const { readSettings, updateSettings, forgetSettings } = await import(
  "./settings.ts"
);
const file = path.join(home, "settings.json");

test("defaults apply when there is no file", async () => {
  assert.deepEqual(await readSettings(), { autoUpdate: true });
});

test("a preference survives a round trip", async () => {
  await updateSettings({ autoUpdate: false });
  forgetSettings();
  assert.equal((await readSettings()).autoUpdate, false);
  assert.deepEqual(JSON.parse(await fsp.readFile(file, "utf8")), {
    autoUpdate: false,
  });
});

test("a corrupt or hand-edited file falls back to the defaults", async () => {
  await fsp.writeFile(file, "{ not json");
  forgetSettings();
  assert.deepEqual(await readSettings(), { autoUpdate: true });

  // Wrong types are ignored rather than trusted.
  await fsp.writeFile(file, JSON.stringify({ autoUpdate: "yes please" }));
  forgetSettings();
  assert.equal((await readSettings()).autoUpdate, true);
});

test("unknown keys are not carried into the file", async () => {
  forgetSettings();
  await fsp.writeFile(file, JSON.stringify({ autoUpdate: false, secret: 1 }));
  forgetSettings();
  await updateSettings({ autoUpdate: true });
  assert.deepEqual(JSON.parse(await fsp.readFile(file, "utf8")), {
    autoUpdate: true,
  });
});

test.after(async () => {
  await fsp.rm(home, { recursive: true, force: true });
});

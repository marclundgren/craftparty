import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { levelDatVersion, saveVersion } from "./level-dat.ts";

// ---- a tiny NBT writer, just enough to build the fixtures ----

const str = (s: string): Buffer => {
  const body = Buffer.from(s, "utf8");
  const len = Buffer.alloc(2);
  len.writeUInt16BE(body.length);
  return Buffer.concat([len, body]);
};

const tagString = (name: string, value: string): Buffer =>
  Buffer.concat([Buffer.from([8]), str(name), str(value)]);

const tagInt = (name: string, value: number): Buffer => {
  const body = Buffer.alloc(4);
  body.writeInt32BE(value);
  return Buffer.concat([Buffer.from([3]), str(name), body]);
};

const compound = (name: string, ...fields: Buffer[]): Buffer =>
  Buffer.concat([Buffer.from([10]), str(name), ...fields, Buffer.from([0])]);

/** A level.dat shaped like the real thing, around the given version. */
const levelDat = (version: string, extra: Buffer[] = []): Buffer =>
  compound(
    "",
    compound(
      "Data",
      ...extra,
      compound(
        "Version",
        tagInt("Id", 4903),
        tagString("Name", version),
        tagString("Series", "main"),
      ),
      tagString("LevelName", "world"),
    ),
  );

test("the version comes out of a gzipped level.dat", () => {
  assert.equal(levelDatVersion(zlib.gzipSync(levelDat("26.2"))), "26.2");
});

test("an uncompressed level.dat reads the same", () => {
  assert.equal(levelDatVersion(levelDat("1.21.8")), "1.21.8");
});

test("tags before the one we want are walked past, not tripped over", () => {
  // Real saves carry floats, longs, lists and arrays ahead of Version;
  // each has to be skipped by exactly its own width or the read derails.
  const before = [
    Buffer.concat([Buffer.from([6]), str("BorderSize"), Buffer.alloc(8)]),
    Buffer.concat([Buffer.from([4]), str("Time"), Buffer.alloc(8)]),
    Buffer.concat([
      Buffer.from([7]),
      str("Bytes"),
      (() => {
        const n = Buffer.alloc(4);
        n.writeInt32BE(3);
        return Buffer.concat([n, Buffer.from([1, 2, 3])]);
      })(),
    ]),
    Buffer.concat([
      Buffer.from([11]),
      str("Ints"),
      (() => {
        const n = Buffer.alloc(4);
        n.writeInt32BE(2);
        return Buffer.concat([n, Buffer.alloc(8)]);
      })(),
    ]),
    Buffer.concat([
      Buffer.from([9]),
      str("Packs"),
      (() => {
        const n = Buffer.alloc(4);
        n.writeInt32BE(2);
        return Buffer.concat([Buffer.from([8]), n, str("vanilla"), str("fabric")]);
      })(),
    ]),
  ];
  assert.equal(levelDatVersion(levelDat("26.1", before)), "26.1");
});

test("a save directory answers with its own version", async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "craftparty-level-"));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));

  await fsp.mkdir(path.join(dir, "world"), { recursive: true });
  await fsp.writeFile(
    path.join(dir, "world", "level.dat"),
    zlib.gzipSync(levelDat("26.2")),
  );
  assert.equal(await saveVersion(dir), "26.2");
});

test("a world that has never been started says nothing", async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "craftparty-level-"));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  assert.equal(await saveVersion(dir), null);
});

test("a level.dat caught mid-write falls back to the backup copy", async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "craftparty-level-"));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));

  await fsp.mkdir(path.join(dir, "world"), { recursive: true });
  const good = zlib.gzipSync(levelDat("26.2"));
  // Half a file: gzip won't even inflate it.
  await fsp.writeFile(path.join(dir, "world", "level.dat"), good.subarray(0, 12));
  await fsp.writeFile(path.join(dir, "world", "level.dat_old"), good);
  assert.equal(await saveVersion(dir), "26.2");
});

test("nonsense in place of a save is not a crash and not a guess", async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "craftparty-level-"));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));

  await fsp.mkdir(path.join(dir, "world"), { recursive: true });
  await fsp.writeFile(
    path.join(dir, "world", "level.dat"),
    Buffer.from("this is not NBT at all"),
  );
  assert.equal(await saveVersion(dir), null);
});

test("a host who renamed level-name is followed to the right save", async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "craftparty-level-"));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));

  await fsp.writeFile(
    path.join(dir, "server.properties"),
    "server-port=25565\nlevel-name=my-realm\ndifficulty=easy\n",
  );
  await fsp.mkdir(path.join(dir, "my-realm"), { recursive: true });
  await fsp.writeFile(
    path.join(dir, "my-realm", "level.dat"),
    zlib.gzipSync(levelDat("26.1")),
  );
  assert.equal(await saveVersion(dir), "26.1");
});

test("a level-name that would climb out of the world directory is ignored", async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "craftparty-level-"));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));

  await fsp.writeFile(
    path.join(dir, "server.properties"),
    "level-name=../../elsewhere\n",
  );
  await fsp.mkdir(path.join(dir, "world"), { recursive: true });
  await fsp.writeFile(
    path.join(dir, "world", "level.dat"),
    zlib.gzipSync(levelDat("26.2")),
  );
  // Falls back to the default save rather than following the path.
  assert.equal(await saveVersion(dir), "26.2");
});

import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

/**
 * Which Minecraft version a save is actually on, read from the save
 * itself.
 *
 * Every world Minecraft writes stamps the version that last saved it into
 * level.dat, and that stamp — not the jar that happens to be downloaded,
 * not what Craftparty remembers — is what decides whether opening the
 * world in a newer Minecraft would upgrade it. Worlds made before
 * Craftparty recorded a version have no note of their own, so this is the
 * only way to answer "what am I about to continue?" for them.
 *
 * level.dat is gzipped NBT: a tagged, big-endian tree. Only
 * Data.Version.Name is wanted, but the tags before it have to be walked
 * past to reach it, so this reads the whole (small — a few hundred bytes)
 * tree and then picks the field out.
 */

const TAG_END = 0;
const TAG_COMPOUND = 10;

type Nbt = unknown;

/**
 * Reader over one NBT buffer. Every read is bounds-checked by Buffer
 * itself, which throws RangeError on a truncated file — caught by the
 * caller, where a half-written level.dat simply means "don't know".
 */
function readNbt(buf: Buffer): Nbt {
  let off = 0;

  const u1 = (): number => buf.readUInt8(off++);
  const i4 = (): number => {
    const v = buf.readInt32BE(off);
    off += 4;
    return v;
  };
  const name = (): string => {
    const len = buf.readUInt16BE(off);
    off += 2;
    const s = buf.toString("utf8", off, off + len);
    off += len;
    return s;
  };

  /** A payload of the given tag type. Sized types are skipped, not built. */
  const payload = (type: number): Nbt => {
    switch (type) {
      case 1: // byte
        return buf.readInt8(off++);
      case 2: {
        // short
        const v = buf.readInt16BE(off);
        off += 2;
        return v;
      }
      case 3: // int
        return i4();
      case 4: {
        // long
        const v = buf.readBigInt64BE(off);
        off += 8;
        return v;
      }
      case 5: // float
        off += 4;
        return null;
      case 6: // double
        off += 8;
        return null;
      case 7: {
        // byte array — chunk data and the like; never wanted here
        const len = i4();
        off += len;
        return null;
      }
      case 8: // string
        return name();
      case 9: {
        // list
        const itemType = u1();
        const len = i4();
        // An empty list still carries a type; TAG_End means nothing follows.
        const items: Nbt[] = [];
        for (let i = 0; i < len; i++) {
          items.push(itemType === TAG_END ? null : payload(itemType));
        }
        return items;
      }
      case TAG_COMPOUND: {
        const out: Record<string, Nbt> = {};
        for (;;) {
          const type = u1();
          if (type === TAG_END) break;
          out[name()] = payload(type);
        }
        return out;
      }
      case 11: {
        // int array
        const len = i4();
        off += len * 4;
        return null;
      }
      case 12: {
        // long array
        const len = i4();
        off += len * 8;
        return null;
      }
      default:
        throw new Error(`Unknown NBT tag ${type}`);
    }
  };

  const rootType = u1();
  if (rootType !== TAG_COMPOUND) throw new Error("Not an NBT compound");
  name(); // the root's own name, always empty in practice
  return payload(rootType);
}

const GZIP_MAGIC = [0x1f, 0x8b];

/** Parse a level.dat buffer, gzipped or not, down to Data.Version.Name. */
export function levelDatVersion(file: Buffer): string | null {
  const nbt = readNbt(
    file[0] === GZIP_MAGIC[0] && file[1] === GZIP_MAGIC[1]
      ? zlib.gunzipSync(file)
      : file,
  ) as { Data?: { Version?: { Name?: unknown } } };
  const version = nbt?.Data?.Version?.Name;
  return typeof version === "string" && version ? version : null;
}

/**
 * The Minecraft version of the save inside a world directory, or null
 * when there isn't one to read — a world that has never been started, a
 * level.dat mid-write, or anything else we can't make sense of. Never
 * throws: not knowing is a normal answer here, and a guess would be
 * worse than none.
 */
export async function saveVersion(worldDir: string): Promise<string | null> {
  const level = await levelName(worldDir);
  // level.dat_old is the previous good copy; Minecraft keeps it precisely
  // because the live one can be caught mid-write.
  for (const candidate of ["level.dat", "level.dat_old"]) {
    try {
      const file = await fsp.readFile(path.join(worldDir, level, candidate));
      const version = levelDatVersion(file);
      if (version) return version;
    } catch {
      // missing, truncated, or not NBT — try the backup, then give up
    }
  }
  return null;
}

/**
 * Where the save lives under the world directory. Craftparty never sets
 * level-name, so it is "world" — but server.properties is the host's file
 * to edit, and an edited one has to be honoured or we'd read the wrong
 * save.
 */
async function levelName(worldDir: string): Promise<string> {
  try {
    const props = await fsp.readFile(
      path.join(worldDir, "server.properties"),
      "utf8",
    );
    const found = /^level-name=(.*)$/m.exec(props)?.[1]?.trim();
    // A name with a separator in it would walk out of the world directory.
    if (found && !/[/\\]/.test(found) && found !== "..") return found;
  } catch {
    // no server.properties yet — the default it would be written with
  }
  return "world";
}

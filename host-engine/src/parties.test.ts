import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const home = await fsp.mkdtemp(path.join(os.tmpdir(), "craftparty-parties-"));
process.env.CRAFTPARTY_HOME = home;

const { encodeInvite } = await import("./party.ts");
const { forgetParty, getParty, listParties, partyId, recordJoined, rememberParty } =
  await import("./parties.ts");
const file = path.join(home, "parties.json");

const invite = (
  party: string,
  controlPlaneUrl = "https://1-2-3-4.sslip.io",
  host = "100.64.0.1",
  // null means an invite that carries no version at all — what a
  // Craftparty from before they travelled would have minted. An explicit
  // undefined can't say that: it would take the default instead.
  minecraft: string | null = "26.2",
) =>
  encodeInvite({
    v: 1,
    party,
    controlPlaneUrl,
    authKey: "key-abc",
    server: { host, port: 25565 },
    minecraft: minecraft ?? undefined,
  });

test("there are no parties before one is joined", async () => {
  assert.deepEqual(await listParties(), []);
});

test("an invite is remembered and comes back whole", async () => {
  const saved = await rememberParty(invite("Dragon Cave"));
  assert.equal(saved.name, "Dragon Cave");
  assert.equal(saved.host, "100.64.0.1");
  assert.equal(saved.port, 25565);
  assert.equal(saved.lastJoinedAt, null);
  assert.deepEqual(await getParty(saved.id), saved);
});

test("an invite says which Minecraft the host is running", async () => {
  const saved = await rememberParty(
    invite("Version Cave", "https://5-5-5-5.sslip.io"),
  );
  assert.equal(saved.minecraftVersion, "26.2");
  assert.equal((await getParty(saved.id)).minecraftVersion, "26.2");
});

test("an invite from before versions travelled keeps what we already knew", async () => {
  const url = "https://4-4-4-4.sslip.io";
  const known = await rememberParty(invite("Old Invite", url));
  assert.equal(known.minecraftVersion, "26.2");
  // Same party, re-pasted from an older Craftparty's code: nothing to say
  // about the version is not the same as saying there isn't one.
  const again = await rememberParty(invite("Old Invite", url, "100.64.0.1", null));
  assert.equal(again.id, known.id);
  assert.equal(again.minecraftVersion, "26.2");
});

test("a party first seen without a version simply has none", async () => {
  const saved = await rememberParty(
    invite("No Version", "https://3-3-3-3.sslip.io", "100.64.0.1", null),
  );
  assert.equal(saved.minecraftVersion, null);
});

test("rejoining the same party refreshes its invite instead of duplicating it", async () => {
  const first = await rememberParty(invite("Nether Base"));
  const fresh = invite("Nether Base");
  const again = await rememberParty(fresh);
  assert.equal(again.id, first.id);
  assert.equal(again.addedAt, first.addedAt); // it is the same entry
  assert.equal(again.inviteCode, fresh);
  const listed = await listParties();
  assert.equal(listed.filter((p) => p.id === first.id).length, 1);
});

test("two hosts' worlds of the same name stay apart", async () => {
  const alice = await rememberParty(invite("Survival", "https://1-1-1-1.sslip.io"));
  const bob = await rememberParty(invite("Survival", "https://2-2-2-2.sslip.io"));
  assert.notEqual(alice.id, bob.id);
  assert.equal((await getParty(alice.id)).controlPlaneUrl, "https://1-1-1-1.sslip.io");
  assert.equal((await getParty(bob.id)).controlPlaneUrl, "https://2-2-2-2.sslip.io");
});

test("the list is newest-joined first", async () => {
  const older = await rememberParty(invite("Old One", "https://9-9-9-9.sslip.io"));
  const newer = await rememberParty(invite("New One", "https://8-8-8-8.sslip.io"));
  // Both were added inside the same millisecond; only a later join can
  // put the older one back on top.
  await new Promise((r) => setTimeout(r, 5));
  await recordJoined(older.id);
  const ids = (await listParties()).map((p) => p.id);
  assert.equal(ids[0], older.id);
  assert.ok(ids.indexOf(older.id) < ids.indexOf(newer.id));
  assert.ok((await getParty(older.id)).lastJoinedAt);
});

test("forgetting removes exactly one party, and says when there was none", async () => {
  const party = await rememberParty(invite("Temporary", "https://7-7-7-7.sslip.io"));
  const before = (await listParties()).length;
  assert.equal(await forgetParty(party.id), true);
  assert.equal((await listParties()).length, before - 1);
  assert.equal(await forgetParty(party.id), false);
  await assert.rejects(() => getParty(party.id));
});

test("a party name is only ever part of the id", async () => {
  // Ids reach the tailscaled state directory, so they stay tame no matter
  // what a host called their world.
  const saved = await rememberParty(
    invite("../../Ouch! 💥", "https://6-6-6-6.sslip.io"),
  );
  assert.match(saved.id, /^[a-z0-9][a-z0-9-]*$/);
  assert.equal(saved.name, "../../Ouch! 💥"); // shown as typed
});

test("something that isn't an invite is refused, not stored", async () => {
  const before = await listParties();
  for (const junk of ["not-an-invite", "", encodeInvite({} as never)]) {
    await assert.rejects(() => rememberParty(junk), {
      message: "Not a valid Craftparty invite code",
    });
  }
  assert.deepEqual(await listParties(), before);
});

test("a hand-edited or corrupt file falls back to an empty list", async () => {
  const saved = await listParties();
  await fsp.writeFile(file, "{ not json");
  assert.deepEqual(await listParties(), []);

  // Entries missing what we'd need to act on are dropped, not trusted.
  await fsp.writeFile(
    file,
    JSON.stringify({ v: 1, parties: [{ id: "half", name: "Half" }, ...saved] }),
  );
  const listed = await listParties();
  assert.ok(!listed.some((p) => p.id === "half"));
  assert.equal(listed.length, saved.length);
});

test("partyId is stable for the same invite", () => {
  const one = {
    v: 1 as const,
    party: "Dragon Cave",
    controlPlaneUrl: "https://1-2-3-4.sslip.io",
    authKey: "a",
    server: { host: "100.64.0.1", port: 25565 },
  };
  assert.equal(partyId(one), partyId({ ...one, authKey: "a-different-key" }));
});

test.after(async () => {
  await fsp.rm(home, { recursive: true, force: true });
});

# Changelog

What changed in each release of Craftparty, written for the people who
use it. Versions match the installers on the
[releases page](https://github.com/marclundgren/craftparty/releases).

The top section of this file becomes the release notes:
`host-app/build/release-notes.md` is generated from it, and
electron-builder posts that as the GitHub release body. See
[the release runbook](.claude/skills/release/SKILL.md).

## Unreleased

## 0.6.1 — hardcore's own line

- 🎚️ **Hardcore is its own difficulty now.** Pick it straight from the
  difficulty list instead of ticking a separate box — same effect, one
  less control.
- 📝 **Medium is now Normal**, matching what it's actually called under
  the hood.

## 0.6.0 — peaceful or hardcore

- 🌍 **Set the difficulty before you start.** New worlds ask how tough you
  want them — Peaceful for no monsters at all, then Easy, Medium or Hard.
- 💀 **Hardcore, if you dare.** One life each: when you die, the world
  locks for good. Off unless you tick it.
- 🌱 **Bring your own seed.** Type in a seed to play a world someone told
  you about, or leave it blank and get one nobody has seen before.
- 🔒 **Your saved worlds are left alone.** These are chosen as a world is
  made, so carrying on with an old world keeps exactly what it started
  with.

## 0.5.0 — its own icon

- 🎨 **Craftparty has a face.** The app ships its own icon — a grass block
  in a party hat — instead of the stock Electron cog, on Windows, macOS
  and Linux, and in the dock while you're running it from source.
- 🚚 **Automatic updates start working here.** 0.4.0 was published in a
  form the updater couldn't see, so it never reached anyone. Install this
  one by hand and later versions arrive on their own.

## 0.4.0 — updates itself

- 🔄 **Updates arrive on their own.** A new version downloads quietly in
  the background and installs when you close the app, so the next launch
  is already the new one.
- ✋ **Or don't.** Turn *Update automatically* off and Craftparty still
  tells you when a version is out, but downloads nothing until you ask.
- 🎮 **Never mid-party.** Updates are never installed while a world is
  running — *Install now* waits until you've stopped the party.
- 🍎 **macOS** reports updates and opens the download page rather than
  installing them; that needs code signing, which these beta builds don't
  have yet.

## 0.3.0 — saved worlds

- 🌍 **Continue a world.** The host tab lists every world you've saved,
  when you last played it and how big it is, so you pick one and carry on
  instead of retyping its name. The addons it last ran with come back
  ticked.
- 🗂️ **Open a world's folder** for backups or for dropping in mods.
- 🗑️ **Delete for good** — permanent, so Craftparty asks first.
- ✋ **No accidental overwrites.** Typing a name that matches a saved
  world says so, and continues that world.
- 💾 **Quitting saves your world.** Cmd/Ctrl+Q now shuts the party down
  properly, the same as closing the window.

## 0.2.0 — the Marketplace

- 🎉 **Addons.** Two to start with: *Stay Hydrated* (a thirst meter) and
  *Welcome Party* (fireworks when a friend joins). They run on your side
  only — friends still join with completely vanilla Minecraft.
- 🛒 Pick them when you start a world, or browse
  [the marketplace](https://craftparty-ten.vercel.app/marketplace).

## 0.1.7 — clean shutdown

- Fixed an error dialog that could appear when quitting.

## 0.1.6 — versioned installers

- Installer filenames now carry the version, and the download button on
  the site points at the exact file for your computer.

## 0.1.5 — plays nice with other Minecraft servers

- Craftparty no longer collides with another Minecraft server already
  running on the usual port.

## 0.1.4 — Windows connection fix

## 0.1.3 — Windows fix + error reporting

- A failed start now writes a diagnostic report you can copy and send.

## 0.1.2 — Windows internet-hosting fix

## 0.1.1 — Windows hosting fix

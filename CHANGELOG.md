# Changelog

What changed in each release of Craftparty, written for the people who
use it. Versions match the installers on the
[releases page](https://github.com/marclundgren/craftparty/releases).

The top section of this file becomes the release notes:
`host-app/build/release-notes.md` is generated from it, and
electron-builder posts that as the GitHub release body. See
[the release runbook](.claude/skills/release/SKILL.md).

## Unreleased

## 0.9.0 — a clearer window

- 🪟 **A tidier window.** Three rows of buttons and status used to sit
  between the top of the window and the two things you came to do. Now
  there are two: Craftparty and your network on one line, Host and Join
  on the next. Which version you're running and whether an update is
  waiting moved to a status bar along the bottom, where you can find them
  when you want them and ignore them when you don't.
- 🌐 **"Internet hosting: probably works" explains itself.** Click it and
  Craftparty tells you what it checked — whether your router will open a
  door for Minecraft, and whether it has a real address on the internet —
  and what it can't check from inside your house, which is whether
  someone out there can actually get through that door. That last part is
  the whole of the "probably". If hosting isn't available at all, it now
  says which piece of your setup is in the way and what you could try.
- 📐 **The running screen fits.** The panel with your address and invite
  had grown a scrollbar that hid its last line. It doesn't scroll any
  more, and on a small window "Stop the party" stays put instead of
  scrolling out of reach.
- ✂️ **Long world names stay in their lane.** Call a world whatever you
  like — the name is trimmed with an ellipsis wherever it's shown, with
  the whole thing on hover, instead of stretching the panel out of shape.
- 🐧 **A .deb for Ubuntu and Debian.** Craftparty installs like a normal
  app there now: it turns up in your app drawer and updates itself in
  place. Other distributions can still take the AppImage, and the
  download page offers whichever suits you.
- 🔗 **Links open in your browser.** The Minecraft EULA link used to open
  a bare window inside Craftparty with no address bar and no way back.
  Every link out of the app goes to your normal browser now — including
  the Craftparty name in the corner, which is a link to the website.
- 🖼️ **The website shows the app.** There's a picture of Craftparty
  actually running a world, so you can see what you're downloading before
  you download it, and shared links unfurl with the same picture.

## 0.8.0 — which Minecraft you're on

- 🧱 **Everyone knows which Minecraft to launch.** The version is now on
  screen wherever you're about to open the game: the new-world form says
  which version your world will be made on, a running world shows it
  right above the address you connect to, and every party in the Join tab
  says which version its host runs — before you connect, so you can start
  the right client the first time.
- 🔎 **Your existing worlds already know.** Worlds you made before this
  update have no version written down, so Craftparty reads it out of the
  save itself — the same stamp Minecraft checks. They show their version
  in the list straight away, and continuing one keeps it there.
- 📌 **New worlds get the newest Minecraft, and keep it.** Craftparty asks
  the Fabric server project which versions it can actually run, so a
  world is never made on a version that won't start — in the few days
  between a Minecraft release and Fabric catching up, you get the newest
  one that's ready. And your world stays on the version it was made with:
  opening a save in a newer Minecraft can't be undone, so it never
  happens behind your back.
- ❤️ **Sponsor Craftparty.** A quiet Sponsor button in the app's top bar
  opens GitHub Sponsors in your browser, and the website has a page
  section explaining what sponsoring pays for. Craftparty stays free, and
  nothing about paying happens inside the app.

## 0.7.0 — see who's up

- 🗂️ **Your parties, in one list.** The Join tab now remembers every party
  you've joined. Be in several at once, see them all at a glance, and
  leave or rejoin any of them whenever you like.
- 🟢 **Know before you knock.** Each party says whether the host is
  running it right now. Once you're in, it shows who's playing, the
  Minecraft version and your ping — refreshed on its own while the tab is
  open.
- 🧹 **Forget the ones you're done with.** Old parties come off the list
  with one click. Nothing on your computer or your friend's is touched.
- 📐 **The button you need is always on screen.** Both tabs now keep their
  heading and their main button in place while the middle scrolls, so
  "Start my world" can't be pushed out of sight by a long list of worlds.
  The window also opens a little taller.
- 📄 **Long lists come in pages.** Once you have more than a handful of
  worlds or parties, the list pages instead of growing forever, and a
  search box appears to jump straight to the one you want.
- 💬 **A bad invite says so.** Pasting half a code (or something that
  isn't a code at all) now gets a plain answer instead of programmer
  gibberish, and what you pasted stays put so you can fix it.

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

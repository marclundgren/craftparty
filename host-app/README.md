# craftparty-host-app

The Craftparty desktop app: an Electron shell around
[`host-engine`](../host-engine). The main process owns everything real —
worlds, parties, updates — and the renderer only draws the state it is
handed over IPC.

```
npm install
npm start          # build + run
npm run dist       # build installers locally (no publishing)
node --experimental-strip-types --test src/settings.test.ts
node --experimental-strip-types --experimental-test-module-mocks --test src/updater.test.ts
```

## Updates

Craftparty updates itself from its own GitHub releases. Tagging `v*` runs
[the release workflow](../.github/workflows/release.yml), which builds on
all three platforms and publishes the installers **plus** the
`latest.yml` / `latest-mac.yml` / `latest-linux.yml` manifests
electron-updater reads. The version in `package.json` is what the tag must
match, and the release must not stay a draft — a draft is invisible to the
updater.

`src/updater.ts` drives it, and nothing downloads without a decision:

- **Automatic (the default).** Craftparty checks on launch and every six
  hours, downloads a new version in the background, and installs it when
  the app closes — so the next launch is the new version. Parties are
  never interrupted for an update.
- **Manual.** Turn *Update automatically* off and Craftparty still tells
  you when a version is out, but downloads nothing until you ask. Taking
  one update that way doesn't turn automatic updates back on.
- **Install now** is offered once an update is downloaded, and is refused
  while a world is running or you're connected to someone else's — it
  restarts the app.

The preference lives in `<dataDir>/settings.json` next to the worlds.

### macOS is deliberately hands-off

On macOS the app reports updates and opens the download page, but never
installs one itself. Squirrel.Mac can only swap in an update from a `zip`
artifact whose code signature matches the running app's, and Craftparty
ships an unsigned `dmg` (the release workflow sets
`CSC_IDENTITY_AUTO_DISCOVERY: false` — no signing identities by
decision). Rather than downloading 100 MB and failing at the last step,
`SELF_INSTALL` in `src/updater.ts` is false there.

Enabling it later is two changes, both required:

1. Sign the mac build with a Developer ID certificate (and notarize it).
2. Add `zip` to `build.mac.target` so the updater has an artifact it can
   apply, then drop the `SELF_INSTALL` exception.

Windows (NSIS, per-user install) and Linux (AppImage) update fine
unsigned. A Linux build started outside its AppImage can't replace
itself; electron-updater declines, and the app says so and points at the
releases page instead of pretending to check forever.

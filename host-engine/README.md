# craftparty-host-engine

Headless engine for the Craftparty host app. Everything the desktop UI does
goes through this package — it downloads the runtimes users would otherwise
have to install themselves and manages them as ordinary child processes.
**No Docker anywhere.**

Zero dependencies; needs Node ≥ 23.6 (runs TypeScript directly).

## What it manages

| Piece            | Source                                   | Status      |
| ---------------- | ---------------------------------------- | ----------- |
| Java runtime     | Temurin JRE via the Adoptium API (sha256-verified) | done |
| Minecraft server | Fabric server launcher jar via meta.fabricmc.net   | done |
| tailscale client | static binaries from pkgs.tailscale.com  | planned     |
| headscale        | GitHub releases (Independent mode only)  | planned     |

Everything lives under `~/.craftparty` (override with `CRAFTPARTY_HOME`):
`runtime/` (JRE), `server/` (jars), `worlds/<id>/` (one dir per world,
including all world data — this is the "your world stays on your machine"
promise in file form).

## Worlds

`src/worlds.ts` owns `worlds/`. A world is a directory plus a small
`craftparty-world.json` (display name, created/last-played stamps, the
addons it last ran with); a directory without that file is still a world,
its metadata reconstructed from the filesystem, so saves from older
versions keep working.

Worlds are permanent by default and independent of any one party:

- **Stopping a party or quitting the app leaves the world on disk.** Both
  paths shut the server down with its console `stop` command, so the save
  is clean and hosting it again resumes exactly where everyone left off.
- **A host can keep as many worlds as they like.** `createWorld()` refuses
  to reuse an existing directory, so a new party never lands on an old
  save by accident; `getWorld()` is the explicit resume path.
- **Nothing is ever deleted implicitly.** `deleteWorld()` is the only
  removal path, and the app puts a native confirmation dialog in front of
  it.

```
node --test src/worlds.test.ts
```

## Vertical-slice smoke test

```
node src/smoke.ts [--verbose]
```

Resolves the latest stable Minecraft + Fabric loader, downloads the JRE and
server jar (idempotent — cached afterward), boots the server, waits for the
"Done" log line, verifies the port accepts TCP connections, then stops it
gracefully.

## Notes

- Starting a server requires `acceptEula: true`; the UI must ask the user to
  accept the Minecraft EULA (https://aka.ms/MinecraftEULA) — the engine
  refuses to write `eula.txt` otherwise.
- `online-mode` stays on: friends connect over the private tailnet, but
  player identity is still verified against Mojang's session service.
- JRE extraction uses `tar` on Linux/macOS and PowerShell `Expand-Archive`
  on Windows — no archive libraries needed.

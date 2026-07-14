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
`runtime/` (JRE), `server/` (jars), `worlds/<name>/` (one dir per party,
including all world data — this is the "your world stays on your machine"
promise in file form).

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

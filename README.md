# Craftparty

Turn your computer into a private Minecraft server for your friends. One
download, no public servers, no port forwarding, no tech skills needed —
your world stays on your machine, and only people you invite can get in.

Free & open source, for Windows, Mac and Linux. See it at
[craftparty.dev](https://craftparty.dev) or grab the latest build from the
[releases page](https://github.com/marclundgren/craftparty/releases).

## How it works

You run Craftparty, click Host, and it launches a real Minecraft (Fabric)
server on your own machine — nothing rented, nothing in the cloud. To let
friends in without opening ports on your router, the host and every friend
join a private mesh network (a tailnet) built on
[Tailscale](https://tailscale.com)/[WireGuard](https://www.wireguard.com):
each friend's Minecraft client talks to `127.0.0.1`, which is quietly
proxied over an encrypted peer-to-peer tunnel straight to the host. An
invite is just a code — decode it and you're on the network.

There's no Docker anywhere; the app manages the JRE, the Minecraft server,
and the networking pieces as ordinary child processes it downloads on first
run.

## Repo layout

This repository holds two things:

- **This Next.js app** (`app/`, `lib/`) — the marketing site, download
  page, and addon marketplace at craftparty.dev.
- **[`host-app/`](host-app)** — the Electron desktop app users actually
  run, built on **[`host-engine/`](host-engine)**, the headless engine that
  manages worlds, the Minecraft server, and the private network.
  **[`preflight/`](preflight)** checks which connection modes (LAN,
  internet via UPnP, etc.) will work on a given network before the host
  app offers them.
- **[`addons/`](addons)** — Fabric mod addons (e.g. `stay-hydrated`,
  `welcome-party`) listed in the in-app and web marketplace.

Each subpackage's own README has the real detail — start with
[`host-engine/README.md`](host-engine/README.md) for how a party is
actually hosted and joined.

## Networking, briefly

Craftparty doesn't run its own coordination servers by default. Hosting a
party ("Independent" mode) spins up
[Headscale](https://github.com/juanfont/headscale) — a self-hostable,
open-source implementation of Tailscale's control plane — as a child
process on the host's own machine, which issues auth keys and coordinates
the tailnet. The host and each friend then run
[`tailscaled`](https://tailscale.com) in userspace-networking mode (no
admin/root, no TUN device) to actually join it. For internet play, the
host's control plane can be exposed via UPnP with a Let's Encrypt cert
minted automatically; NAT traversal that can't go peer-to-peer falls back
to Tailscale's public DERP relays.

There's also an "Assisted" mode that points at a shared, externally-run
control plane instead of spinning one up locally, for hosts whose network
can't self-expose.

See [`host-engine/src/party.ts`](host-engine/src/party.ts) for exactly how
a party is assembled.

## Developing the website

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
npm run lint
```

For the desktop app and engine, see
[`host-app/README.md`](host-app/README.md) and
[`host-engine/README.md`](host-engine/README.md).

## Releases

Desktop app releases are cut with `/release` — see
[`.claude/skills/release/SKILL.md`](.claude/skills/release/SKILL.md) and
[`CHANGELOG.md`](CHANGELOG.md) for what shipped in each version.

# craftparty-preflight

Answers one question: **which Craftparty connection modes will work on this
network?** The host app runs this logic before showing the setup choice, so
users are never offered a mode that can't work for them.

Zero dependencies; needs Node ≥ 23.6 (runs TypeScript directly).

```
node src/cli.ts          # probe only (read-only)
node src/cli.ts --map    # also create + verify + remove a real UPnP port mapping
node src/cli.ts --json   # machine-readable report
node --test "src/**/*.test.ts"   # run tests
```

## What it checks

1. **Local addresses** — classifies every IPv4 interface (private / CGNAT /
   public).
2. **Public IP** — as seen from the internet, and whether it's in
   100.64.0.0/10 (RFC 6598 → carrier-grade NAT, no inbound path, ever).
3. **UPnP gateway** — SSDP discovery of the router, then
   `GetExternalIPAddress` to compare what the router thinks its address is
   with what the internet sees (mismatch → double NAT).
4. **Mapping test** (`--map`) — creates a real 120-second TCP port mapping,
   tries to reach it via the public IP, then deletes it. Self-connection
   failure is reported as *inconclusive* (hairpin NAT is often unsupported),
   never as proof of failure.

## Verdicts

| Verdict             | Meaning                                                        |
| ------------------- | -------------------------------------------------------------- |
| `independent`       | Auto-expose will work: UPnP + public IP + verified mapping.     |
| `independent-maybe` | Looks plausible but not fully verified end-to-end.              |
| `assisted`          | CGNAT, double NAT, or no UPnP — the shared relay is needed.     |

Every verdict comes with human-readable reasons; the report also warns when
running inside WSL/a VM, where the virtual network can make results more
pessimistic than the physical machine's.

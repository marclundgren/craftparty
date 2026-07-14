#!/usr/bin/env node
import { probe, type ProbeReport } from "./probe.ts";

const args = new Set(process.argv.slice(2));

if (args.has("--help") || args.has("-h")) {
  console.log(`craftparty-preflight — which connection modes work on this network?

Usage: craftparty-preflight [options]

Options:
  --map     Also create (and remove) a real test port mapping via UPnP
  --json    Machine-readable output
  --help    Show this help
`);
  process.exit(0);
}

const report = await probe({ runMappingTest: args.has("--map") });

if (args.has("--json")) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

print(report);

function print(r: ProbeReport) {
  const label: Record<ProbeReport["verdict"], string> = {
    independent: "INDEPENDENT mode should work",
    "independent-maybe": "INDEPENDENT mode might work (not fully verified)",
    assisted: "ASSISTED mode required",
  };

  console.log("\ncraftparty preflight\n────────────────────");
  console.log(
    `local addresses   ${
      r.localIps.map((ip) => `${ip.address} (${ip.kind}, ${ip.iface})`).join(", ") ||
      "none found"
    }`,
  );
  console.log(
    `public IP         ${r.publicIp ?? "unknown"}${r.publicIpKind ? ` (${r.publicIpKind})` : ""}`,
  );
  console.log(
    `UPnP gateway      ${
      r.upnp.found
        ? `${r.upnp.friendlyName ?? "found"}${r.upnp.externalIp ? `, external IP ${r.upnp.externalIp} (${r.upnp.externalIpKind})` : ""}`
        : "not found"
    }`,
  );
  if (r.mappingTest.ran) {
    console.log(
      `mapping test      ${
        r.mappingTest.mapped
          ? `mapped OK; self-connect ${
              r.mappingTest.loopbackReached === true
                ? "reached"
                : r.mappingTest.loopbackReached === false
                  ? "not reached (inconclusive — hairpin NAT)"
                  : "skipped"
            }`
          : `failed: ${r.mappingTest.error}`
      }`,
    );
  }

  console.log(`\nverdict: ${label[r.verdict]}`);
  for (const reason of r.reasons) console.log(`  · ${reason}`);
  if (r.warnings.length) {
    console.log("\nwarnings:");
    for (const w of r.warnings) console.log(`  ! ${w}`);
  }
  console.log();
}

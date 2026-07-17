import net from "node:net";

/**
 * First TCP port at or above `start` that is genuinely free.
 *
 * A plain test-bind is not enough: libuv sets SO_REUSEADDR, which on
 * Windows "succeeds" on ports another process already holds, and servers
 * we launch (Minecraft) bind the dual-stack wildcard, so a listener on
 * either stack's loopback (e.g. WSL's wslrelay on ::1) breaks them. A
 * port only counts as free when it binds exclusively AND nothing answers
 * a connect on the loopbacks.
 *
 * Pass `host` for listeners bound to one specific address; omit it for
 * servers that bind the wildcard (checks both stacks).
 */
export async function findFreePort(
  start: number,
  host?: string,
): Promise<number> {
  const binds = host ? [host] : ["0.0.0.0", "::"];
  const probes = host ? [host] : ["127.0.0.1", "::1"];
  for (let port = start; port < start + 100; port++) {
    let ok = true;
    for (const addr of binds) {
      if (!(await canBind(port, addr))) {
        ok = false;
        break;
      }
    }
    for (const addr of probes) {
      if (!ok) break;
      if (await accepts(port, addr)) ok = false;
    }
    if (ok) return port;
  }
  throw new Error(`No free port found in ${start}–${start + 99}`);
}

function canBind(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", (err) => {
      // No IPv6 on this machine at all — nothing to conflict with there.
      const code = (err as NodeJS.ErrnoException).code;
      resolve(code === "EAFNOSUPPORT" || code === "EADDRNOTAVAIL");
    });
    srv.listen({ port, host, exclusive: true }, () =>
      srv.close(() => resolve(true)),
    );
  });
}

function accepts(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    const done = (value: boolean) => {
      sock.destroy();
      resolve(value);
    };
    sock.setTimeout(500, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

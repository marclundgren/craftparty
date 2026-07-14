import net from "node:net";

/**
 * Minimal SOCKS5 CONNECT client (no auth) — how apps reach INTO the tailnet
 * through a userspace tailscaled's --socks5-server.
 */
export function socks5Connect(
  proxyPort: number,
  destHost: string,
  destPort: number,
  timeoutMs = 10_000,
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port: proxyPort });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("SOCKS5 connect timed out"));
    }, timeoutMs);
    const fail = (msg: string) => {
      clearTimeout(timer);
      socket.destroy();
      reject(new Error(msg));
    };

    socket.once("error", (err) => fail(`SOCKS5 socket error: ${err.message}`));
    socket.once("connect", () => {
      // greeting: version 5, one method, no-auth
      socket.write(Buffer.from([0x05, 0x01, 0x00]));
      socket.once("data", (greeting) => {
        if (greeting[0] !== 0x05 || greeting[1] !== 0x00) {
          return fail("SOCKS5 greeting rejected");
        }
        // CONNECT with a domain-type address (works for IPs and names)
        const host = Buffer.from(destHost, "ascii");
        const req = Buffer.concat([
          Buffer.from([0x05, 0x01, 0x00, 0x03, host.length]),
          host,
          Buffer.from([(destPort >> 8) & 0xff, destPort & 0xff]),
        ]);
        socket.write(req);
        socket.once("data", (reply) => {
          if (reply[0] !== 0x05 || reply[1] !== 0x00) {
            return fail(`SOCKS5 CONNECT failed (code ${reply[1]})`);
          }
          clearTimeout(timer);
          resolve(socket);
        });
      });
    });
  });
}

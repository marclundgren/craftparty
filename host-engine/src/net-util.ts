import net from "node:net";

/** First free TCP port at or above `start`. */
export async function findFreePort(
  start: number,
  host = "0.0.0.0",
): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const srv = net.createServer();
      srv.once("error", () => resolve(false));
      srv.listen(port, host, () => srv.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error(`No free port found in ${start}–${start + 99}`);
}

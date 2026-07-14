import type net from "node:net";

/**
 * Minecraft server-list ping over an already-connected socket.
 * Returns the parsed status JSON (version, players, motd).
 */
export function minecraftStatus(
  socket: net.Socket,
  host: string,
  port: number,
  timeoutMs = 10_000,
): Promise<{ version?: { name?: string }; players?: { max?: number } }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Minecraft status ping timed out"));
    }, timeoutMs);

    const hostBuf = Buffer.from(host, "utf8");
    // handshake: id 0x00, protocol -1, host, port, next-state 1 (status)
    const handshake = Buffer.concat([
      Buffer.from([0x00]),
      varint(-1),
      varint(hostBuf.length),
      hostBuf,
      Buffer.from([(port >> 8) & 0xff, port & 0xff]),
      varint(1),
    ]);
    socket.write(Buffer.concat([varint(handshake.length), handshake]));
    // status request: empty packet id 0x00
    socket.write(Buffer.from([0x01, 0x00]));

    let buf = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      try {
        let off = 0;
        const [, lenBytes] = readVarint(buf, off);
        off += lenBytes;
        const [packetLen] = readVarint(buf, 0);
        if (buf.length < lenBytes + packetLen) return; // wait for more
        const [packetId, idBytes] = readVarint(buf, off);
        off += idBytes;
        if (packetId !== 0x00) throw new Error(`Unexpected packet ${packetId}`);
        const [strLen, strBytes] = readVarint(buf, off);
        off += strBytes;
        const json = buf.subarray(off, off + strLen).toString("utf8");
        clearTimeout(timer);
        socket.off("data", onData);
        resolve(JSON.parse(json));
      } catch (err) {
        if (err instanceof RangeError) return; // incomplete varint — wait
        clearTimeout(timer);
        socket.destroy();
        reject(err);
      }
    };
    socket.on("data", onData);
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function varint(value: number): Buffer {
  const out: number[] = [];
  let v = value >>> 0 || (value < 0 ? value >>> 0 : value);
  v = value < 0 ? value >>> 0 : value;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    out.push(byte);
  } while (v !== 0);
  return Buffer.from(out);
}

function readVarint(buf: Buffer, offset: number): [value: number, bytes: number] {
  let value = 0;
  let bytes = 0;
  for (;;) {
    if (offset + bytes >= buf.length) throw new RangeError("incomplete varint");
    const byte = buf[offset + bytes];
    value |= (byte & 0x7f) << (7 * bytes);
    bytes++;
    if ((byte & 0x80) === 0) return [value, bytes];
    if (bytes > 5) throw new Error("varint too long");
  }
}

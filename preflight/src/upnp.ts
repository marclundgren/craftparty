import dgram from "node:dgram";

const SSDP_ADDR = "239.255.255.250";
const SSDP_PORT = 1900;
const SEARCH_TARGETS = [
  "urn:schemas-upnp-org:device:InternetGatewayDevice:1",
  "urn:schemas-upnp-org:device:InternetGatewayDevice:2",
];
// WANIPConnection preferred; WANPPPConnection for DSL-style gateways.
const WAN_SERVICES = [
  "urn:schemas-upnp-org:service:WANIPConnection:2",
  "urn:schemas-upnp-org:service:WANIPConnection:1",
  "urn:schemas-upnp-org:service:WANPPPConnection:1",
];

export interface Gateway {
  location: string;
  controlUrl: string;
  serviceType: string;
  friendlyName: string | null;
}

export async function discoverGateway(
  timeoutMs = 4000,
): Promise<Gateway | null> {
  const location = await ssdpSearch(timeoutMs);
  if (!location) return null;
  try {
    return await describeGateway(location);
  } catch {
    return null;
  }
}

function ssdpSearch(timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      try {
        socket.close();
      } catch {
        // already closed
      }
      resolve(value);
    };
    socket.on("error", () => finish(null));
    socket.on("message", (msg) => {
      const m = /^location:\s*(.+)$/im.exec(msg.toString());
      if (m) finish(m[1].trim());
    });
    socket.bind(0, () => {
      for (const st of SEARCH_TARGETS) {
        const req = [
          "M-SEARCH * HTTP/1.1",
          `HOST: ${SSDP_ADDR}:${SSDP_PORT}`,
          'MAN: "ssdp:discover"',
          "MX: 2",
          `ST: ${st}`,
          "",
          "",
        ].join("\r\n");
        socket.send(req, SSDP_PORT, SSDP_ADDR, () => {
          // errors surface via the 'error' handler
        });
      }
    });
    setTimeout(() => finish(null), timeoutMs);
  });
}

async function describeGateway(location: string): Promise<Gateway | null> {
  const res = await fetch(location, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;
  const xml = await res.text();
  const friendlyName = tag(xml, "friendlyName");
  const urlBase = tag(xml, "URLBase") ?? location;

  for (const serviceType of WAN_SERVICES) {
    for (const block of xml.matchAll(/<service>([\s\S]*?)<\/service>/g)) {
      const svc = block[1];
      if (tag(svc, "serviceType") !== serviceType) continue;
      const controlPath = tag(svc, "controlURL");
      if (!controlPath) continue;
      return {
        location,
        serviceType,
        controlUrl: new URL(controlPath, urlBase).toString(),
        friendlyName,
      };
    }
  }
  return null;
}

function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}[^>]*>([^<]*)</${name}>`).exec(xml);
  return m ? m[1].trim() : null;
}

async function soap(
  gw: Gateway,
  action: string,
  argsXml: string,
): Promise<string> {
  const body =
    `<?xml version="1.0"?>` +
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>` +
    `<u:${action} xmlns:u="${gw.serviceType}">${argsXml}</u:${action}>` +
    `</s:Body></s:Envelope>`;
  const res = await fetch(gw.controlUrl, {
    method: "POST",
    headers: {
      "Content-Type": 'text/xml; charset="utf-8"',
      SOAPAction: `"${gw.serviceType}#${action}"`,
    },
    body,
    signal: AbortSignal.timeout(5000),
  });
  const text = await res.text();
  if (!res.ok) {
    const code = tag(text, "errorCode");
    const desc = tag(text, "errorDescription");
    throw new Error(
      `${action} failed: HTTP ${res.status}` +
        (code ? ` (UPnP error ${code}${desc ? `: ${desc}` : ""})` : ""),
    );
  }
  return text;
}

export async function getExternalIp(gw: Gateway): Promise<string | null> {
  const xml = await soap(gw, "GetExternalIPAddress", "");
  return tag(xml, "NewExternalIPAddress");
}

export interface PortMapping {
  externalPort: number;
  internalPort: number;
  internalClient: string;
  protocol: "TCP" | "UDP";
  description: string;
  leaseSeconds: number;
}

export async function addPortMapping(
  gw: Gateway,
  m: PortMapping,
): Promise<void> {
  await soap(
    gw,
    "AddPortMapping",
    `<NewRemoteHost></NewRemoteHost>` +
      `<NewExternalPort>${m.externalPort}</NewExternalPort>` +
      `<NewProtocol>${m.protocol}</NewProtocol>` +
      `<NewInternalPort>${m.internalPort}</NewInternalPort>` +
      `<NewInternalClient>${m.internalClient}</NewInternalClient>` +
      `<NewEnabled>1</NewEnabled>` +
      `<NewPortMappingDescription>${m.description}</NewPortMappingDescription>` +
      `<NewLeaseDuration>${m.leaseSeconds}</NewLeaseDuration>`,
  );
}

export async function deletePortMapping(
  gw: Gateway,
  externalPort: number,
  protocol: "TCP" | "UDP",
): Promise<void> {
  await soap(
    gw,
    "DeletePortMapping",
    `<NewRemoteHost></NewRemoteHost>` +
      `<NewExternalPort>${externalPort}</NewExternalPort>` +
      `<NewProtocol>${protocol}</NewProtocol>`,
  );
}

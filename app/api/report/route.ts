import { put } from "@vercel/blob";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 128 * 1024;

/**
 * Crash/error reports posted by the Craftparty desktop app when starting
 * or joining a party fails. Stored privately in Vercel Blob; browse with
 * `vercel blob list --prefix reports/`.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: "report too large" }, { status: 413 });
  }
  let report: Record<string, unknown>;
  try {
    report = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const id =
    typeof report.id === "string" && /^[a-f0-9-]{36}$/.test(report.id)
      ? report.id
      : crypto.randomUUID();
  const day = new Date().toISOString().slice(0, 10);
  await put(
    `reports/${day}/${id}.json`,
    JSON.stringify({ ...report, receivedAt: new Date().toISOString() }),
    { access: "private", contentType: "application/json", addRandomSuffix: false },
  );
  return Response.json({ ok: true, id });
}

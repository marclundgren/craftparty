import { ADDONS } from "../../lib/addons";

// Machine-readable registry the desktop app fetches to offer addons at
// world-start. Kept in lockstep with the marketplace page.
export async function GET() {
  return Response.json({ v: 1, addons: ADDONS });
}

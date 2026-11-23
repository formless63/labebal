import { requireRole } from "../../server/identity";
import { detectZpl, listNetPrinters, saveNetPrinter } from "../../server/netprinters";
import { parseBody } from "../../server/validate";
import { whoFrom } from "../../server/versions";
import { addSchema, errText } from "./schema";

/** Network printers set up for the team. */
export async function GET(req: Request) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  return Response.json(await listNetPrinters(), { headers: { "cache-control": "no-store" } });
}

/** Add a network printer: reads its resolution and head width (or takes them as given). Admins. */
export async function POST(req: Request) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const body = await parseBody(req, addSchema);
  if (!body.ok) return body.res;
  const b = body.data;
  let dpi = b.dpi;
  let headDots = b.headDots;
  let model = b.model ?? "";
  if (!dpi || !headDots) {
    try {
      const d = await detectZpl(b.host, b.port);
      dpi ??= d.dpi;
      headDots ??= d.headDots;
      model = d.model;
    } catch (e) {
      return Response.json({ error: `${errText(e)} Enter the resolution and head width by hand to add it anyway.` }, { status: 502 });
    }
  }
  const id = `np-${crypto.randomUUID().slice(0, 8)}`;
  // Desktop Zebras with a ribbon spindle do both; the stock decides per print.
  const p = await saveNetPrinter(id, { name: b.name, host: b.host, port: b.port, dpi: dpi!, headDots: headDots!, model, thermal: b.thermal ?? "both" }, whoFrom(req));
  return Response.json(p, { status: 201 });
}

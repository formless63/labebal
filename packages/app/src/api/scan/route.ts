import { normalizeScan } from "@labebal/core/integrations";
import { scanLookup } from "../../server/scan";

/** Labels and dataset rows for a scanned code: `?q=` */
export async function GET(req: Request) {
  const q = normalizeScan(new URL(req.url).searchParams.get("q") ?? "").slice(0, 500);
  return Response.json(await scanLookup(q));
}

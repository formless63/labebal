import { packsView } from "../../server/packs";

/** Sources (with their cached pack listings; tokens never included) and installed packs. */
export async function GET() {
  return Response.json(await packsView(), { headers: { "cache-control": "no-store" } });
}

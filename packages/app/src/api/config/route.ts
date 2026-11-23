import { publicUrlFromEnv } from "../../server/label-page";

/**
 * Runtime settings the browser needs. `publicUrl`: base of the label page links
 * that `{{labelUrl}}` prints (LABEBAL_PUBLIC_URL); null = use the page's origin.
 */
export async function GET() {
  return Response.json({ publicUrl: publicUrlFromEnv() ?? null }, { headers: { "cache-control": "no-store" } });
}

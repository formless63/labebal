import { iconSets } from "../../../server/icons";

/** Icon libraries: { id, label, title, count, license, author?, filled, note? }[] (custom last). */
export async function GET() {
  return Response.json(await iconSets(), { headers: { "cache-control": "no-cache" } });
}

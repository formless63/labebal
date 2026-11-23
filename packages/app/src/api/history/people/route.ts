import { listPeople } from "../../../server/history";

/** Names that appear in the print history (for the "who" filter). */
export async function GET() {
  return Response.json(await listPeople());
}

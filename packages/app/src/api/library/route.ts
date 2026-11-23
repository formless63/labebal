import { getLibrary } from "../../server/library";

/** Whole library: templates + labels. Also serves as the JSON export. */
export async function GET() {
  return Response.json(await getLibrary());
}

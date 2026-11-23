import { getParts } from "../../server/parts";

/** All reusable components. */
export async function GET() {
  return Response.json((await getParts()).components);
}

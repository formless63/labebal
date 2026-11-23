import { getParts } from "../../server/parts";

/** All shared text styles. */
export async function GET() {
  return Response.json((await getParts()).styles);
}

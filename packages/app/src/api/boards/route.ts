import { listBoards, saveBoard } from "../../server/boards";
import { parseBody } from "../../server/validate";
import { boardSchema } from "../../server/validate-data";
import { requireRole } from "../../server/identity";

export async function GET() {
  return Response.json(await listBoards());
}

export async function POST(req: Request) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const body = await parseBody(req, boardSchema);
  if (!body.ok) return body.res;
  return Response.json(await saveBoard(body.data), { status: 201 });
}

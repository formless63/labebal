import type { Ctx } from "../../../http";
import { z } from "zod";
import { setLabelNotes } from "../../../../server/label-page";
import { parseBody } from "../../../../server/validate";
import { whoFrom } from "../../../../server/versions";
import { requireRole } from "../../../../server/identity";

const notesSchema = z.object({ notes: z.string().max(20_000) });

/** Replace a label's notes (shown on its page): `{ notes }`, "" clears them. Editors. */
export async function PUT(req: Request, ctx: Ctx<"/labels/[id]/notes">) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await parseBody(req, notesSchema);
  if (!body.ok) return body.res;
  const notes = await setLabelNotes(id, body.data.notes, whoFrom(req));
  if (!notes) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(notes);
}

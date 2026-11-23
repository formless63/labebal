import { exportPackZip } from "../../../server/packs";
import { parseBody } from "../../../server/validate";
import { exportSchema, packErrors } from "../../../server/validate-packs";

/** "Export as pack": zip of `<id>/labebal-pack.json` + templates / labels (CSV) / datasets / assets / fonts. */
export async function POST(req: Request) {
  const body = await parseBody(req, exportSchema);
  if (!body.ok) return body.res;
  return packErrors(async () => {
    const r = await exportPackZip(body.data);
    return new Response(r.data as BodyInit, {
      headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${r.name}"`, "x-labebal-counts": JSON.stringify(r.counts) },
    });
  });
}

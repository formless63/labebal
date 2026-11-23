import { withToken } from "../../../server/auth";
import { listTemplatesPublic } from "../../../server/public-api";

/** Public: templates with their fields (what `values` a label can have). */
export const GET = withToken(async () => Response.json(await listTemplatesPublic()));

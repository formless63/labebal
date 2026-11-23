import { listCalibrations } from "../../server/printers";

/** Saved printer calibrations (by serial number). */
export async function GET() {
  return Response.json(await listCalibrations());
}

/**
 * Printer calibration by serial number: shared by every browser and person,
 * so a printer only needs calibrating once.
 */
import { asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { printerCalibrations } from "../db/schema";

export interface PrinterCalibration {
  serial: string;
  model: string;
  name: string;
  offset: { x: number; y: number };
  source: "calibrated" | "suggested";
  updatedBy: string;
  updatedAt: string;
}

const toCal = (r: typeof printerCalibrations.$inferSelect): PrinterCalibration => ({
  serial: r.serial,
  model: r.model,
  name: r.name,
  offset: { x: r.offsetX, y: r.offsetY },
  source: r.source === "suggested" ? "suggested" : "calibrated",
  updatedBy: r.updatedBy,
  updatedAt: r.updatedAt.toISOString(),
});

export async function listCalibrations(): Promise<PrinterCalibration[]> {
  const db = await getDb();
  return (await db.select().from(printerCalibrations).orderBy(asc(printerCalibrations.serial))).map(toCal);
}

export async function saveCalibration(c: Omit<PrinterCalibration, "updatedAt">): Promise<PrinterCalibration> {
  const db = await getDb();
  const row = { serial: c.serial, model: c.model, name: c.name, offsetX: c.offset.x, offsetY: c.offset.y, source: c.source, updatedBy: c.updatedBy, updatedAt: new Date() };
  const [r] = await db.insert(printerCalibrations).values(row).onConflictDoUpdate({ target: printerCalibrations.serial, set: row }).returning();
  return toCal(r);
}

export async function deleteCalibration(serial: string) {
  const db = await getDb();
  await db.delete(printerCalibrations).where(eq(printerCalibrations.serial, serial));
}

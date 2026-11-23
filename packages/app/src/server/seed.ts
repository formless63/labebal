import type { DB } from "../db";
import { setupBuiltinPacks } from "./packs";

/**
 * Start-up data. Templates and labels come from packs (Settings > Packs);
 * a new library gets the built-in Label Muncher and Standard formats.
 */
export async function seedIfEmpty(db: DB) {
  await setupBuiltinPacks(db);
}

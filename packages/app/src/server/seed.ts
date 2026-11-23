import type { DB } from "../db";
import { setupBuiltinPacks } from "./packs";

/**
 * Start-up data. A fresh install starts with an empty library: templates
 * and labels come from packs (Settings > Packs), including the built-in
 * Examples pack, which is listed but not installed.
 */
export async function seedIfEmpty(db: DB) {
  await setupBuiltinPacks(db);
}

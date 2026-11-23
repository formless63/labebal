/**
 * The standalone app is just one host of the labebal module: mounted at the
 * site root, with its own database (PGlite or DATABASE_URL), identity from
 * proxy headers and settings from LABEBAL_* environment variables (all the
 * module's defaults).
 */
import path from "node:path";
import { createLabebalServer } from "@labebal/app/server";

export const labebal = createLabebalServer({
  // Next bundles the server code, so tell the module where its runtime files
  // (migrations, built-in fonts, the Examples pack) are: dev and Docker both run
  // from apps/web with the package at ../../packages/app.
  filesDir: process.env.LABEBAL_FILES_DIR ?? path.resolve(process.cwd(), "../../packages/app"),
});

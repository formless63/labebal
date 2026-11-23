import { defineConfig } from "tsdown";

/** One output file per source file, so every `@labebal/core/<file>` import works. */
export default defineConfig({
  entry: ["src/*.ts", "!src/*.d.ts"],
  format: "esm",
  platform: "neutral",
  target: "es2022",
  unbundle: true,
  dts: true,
  fixedExtension: false,
});

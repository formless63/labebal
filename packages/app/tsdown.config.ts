import { defineConfig } from "tsdown";

const shared = { format: "esm", target: "es2022", fixedExtension: false, outDir: "dist" } as const;

export default defineConfig([
  // dist/ mirrors src/ (so server/host still finds drizzle/, assets/ and packs/).
  {
    ...shared,
    entry: ["src/client.tsx", "src/server.ts", "src/db/schema.ts"],
    platform: "neutral",
    unbundle: true,
    dts: true,
    deps: { neverBundle: [/^node:/, /^@labebal\//] },
  },
  // SheetJS releases are not on npm: ship it inside dist so installers never fetch a URL dependency.
  {
    ...shared,
    entry: { "vendor/xlsx": "src/vendor/xlsx.ts" },
    platform: "browser",
    clean: false,
    dts: false,
    minify: true,
    deps: { alwaysBundle: ["xlsx"], onlyBundle: ["xlsx"] },
  },
]);

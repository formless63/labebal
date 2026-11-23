import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  output: "standalone",
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@labebal/core", "@labebal/app"],
  // Embedded Postgres ships WASM + data files; load it from node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;

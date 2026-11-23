/**
 * The package is marked side-effect free, so bundlers drop modules that only
 * register something when imported. Bundle the client like a host app would
 * and check that what it needs at run time is still there.
 */
import path from "node:path";
import { rolldown } from "rolldown";
import { describe, expect, it } from "vitest";

describe("client bundle", () => {
  it("registers the icon source", async () => {
    const entry = path.resolve(__dirname, "client.tsx").replaceAll("\\", "/");
    const build = await rolldown({
      input: "virtual:host",
      logLevel: "silent",
      external: (id) => !id.startsWith(".") && !path.isAbsolute(id) && !id.startsWith("virtual:"),
      plugins: [
        {
          name: "host",
          resolveId: (id) => (id === "virtual:host" ? id : null),
          load: (id) => (id === "virtual:host" ? `import { LabebalApp } from ${JSON.stringify(entry)}; console.log(LabebalApp);` : null),
        },
      ],
    });
    const { output } = await build.generate({ format: "esm" });
    const code = output.map((o) => (o.type === "chunk" ? o.code : "")).join("\n");
    expect(code).toMatch(/setIconSource\(/);
    expect(code).toMatch(/^registerIconSource\(\)/m);
  }, 60_000);
});

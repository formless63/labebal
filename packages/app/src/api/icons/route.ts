import { searchIcons } from "../../server/icons";

/**
 * Search icons. ?q=<words>&set=<all|tabler|mdi|lucide|game-icons|simple-icons|custom>&limit=<1-500, default 60>
 * -> { id, name, set, filled }[]. `id` is what an icon node stores (`set:name`,
 * Tabler: plain name); `name` is the name within its set. `q` may start with
 * `set:` to restrict to that set.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const limit = Math.min(500, Math.max(1, Number(sp.get("limit")) || 60));
  const set = sp.get("set")?.trim() || "all";
  const q = sp.get("q") ?? "";
  // Built-in sets never change between deploys; results that can include custom icons must stay fresh.
  const builtinOnly = !["all", "custom"].includes(set) || /^\s*(tabler|mdi|lucide|game-icons|simple-icons):/i.test(q);
  return Response.json(await searchIcons(q, { set, limit }), {
    headers: { "cache-control": builtinOnly ? "public, max-age=3600" : "no-cache" },
  });
}

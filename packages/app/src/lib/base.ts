/**
 * Where the module is mounted in the browser. `<LabebalApp basePath>` sets it
 * before anything renders; client code builds every app link and API URL
 * through these helpers (read at call time, never at module load).
 */
let basePath = "";

export function setBasePath(b: string | undefined) {
  const s = (b ?? "").trim().replace(/\/+$/, "");
  basePath = !s ? "" : s.startsWith("/") ? s : `/${s}`;
}

/** e.g. "/labels" ("" at the root). */
export const appBase = () => basePath;

/** Root of the API, e.g. "/labels/api". */
export const apiRoot = () => `${basePath}/api`;

/** labebal's static files (built-in fonts, mockup photos), e.g. staticUrl("/fonts/x.ttf"). */
export const staticUrl = (p: string) => `${apiRoot()}/static${p.startsWith("/") ? p : `/${p}`}`;

/** App path ("/templates/x") -> browser path ("/labels/templates/x"). Leaves absolute URLs and "#…" alone. */
export function appHref(href: string): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  return `${basePath}${href === "/" && basePath ? "" : href}` || "/";
}

/** Browser path -> app path ("/labels/templates/x" -> "/templates/x"); null when outside the mount. */
export function appPathOf(pathname: string): string | null {
  if (!basePath) return pathname || "/";
  if (pathname === basePath) return "/";
  if (pathname.startsWith(`${basePath}/`)) return pathname.slice(basePath.length);
  return null;
}

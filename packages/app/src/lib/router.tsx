"use client";
/**
 * labebal's own small router, so the screens run inside any React app (Next,
 * Vite, React Router, TanStack Start, ...). Paths are app paths ("/templates/x");
 * the mount point (lib/base.ts) is added and removed here.
 *
 * By default it drives the browser History API directly, which works in
 * every host (Next.js keeps its own state in sync with pushState). A host
 * that wants navigation to go through its router passes `navigate`.
 */
import { createContext, useContext, useMemo, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { appHref, appPathOf } from "./base";

export interface RouterAdapter {
  /** Navigate to a browser href (already including the base path). */
  navigate: (href: string, opts: { replace: boolean }) => void;
}

interface Loc {
  path: string;
  search: string;
}

interface RouterState {
  loc: Loc;
  params: Record<string, string>;
  navigate: (href: string, opts?: { replace?: boolean }) => void;
}

const Ctx = createContext<RouterState | null>(null);
const ParamsCtx = createContext<Record<string, string>>({});

/** Navigation events our own pushState calls emit (History API has none). */
const EVENT = "labebal:navigate";

/** Current location as one string ("<app path>?<search>"), stable between changes for useSyncExternalStore. */
const snapshot = () => `${appPathOf(window.location.pathname) ?? "/"}${window.location.search}`;

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

function parse(s: string): Loc {
  const q = s.indexOf("?");
  return q < 0 ? { path: s, search: "" } : { path: s.slice(0, q), search: s.slice(q) };
}

/**
 * On the server (and while hydrating) the location is `initialPath`, or ""
 * (= not known yet: screens show a placeholder) so server and browser markup
 * agree; then the browser URL takes over.
 */
export function RouterProvider({ adapter, initialPath, children }: { adapter?: RouterAdapter; initialPath?: string; children: ReactNode }) {
  const current = useSyncExternalStore(subscribe, snapshot, () => initialPath ?? "");
  const loc = useMemo(() => parse(current), [current]);
  const state = useMemo<RouterState>(
    () => ({
      loc,
      params: {},
      navigate: (href, opts) => {
        const full = appHref(href);
        if (/^[a-z]+:/i.test(full)) {
          window.location.assign(full);
          return;
        }
        if (adapter) adapter.navigate(full, { replace: !!opts?.replace });
        else if (opts?.replace) window.history.replaceState(window.history.state, "", full);
        else window.history.pushState(window.history.state, "", full);
        // Hash-only jumps (/settings#icons) keep the browser's scrolling to the anchor.
        window.dispatchEvent(new Event(EVENT));
        if (!full.includes("#")) window.scrollTo?.(0, 0);
      },
    }),
    [loc, adapter],
  );
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

function useRouterState(): RouterState {
  const s = useContext(Ctx);
  if (!s) throw new Error("labebal: router hooks must be used inside <LabebalApp>");
  return s;
}

/** Same calls the screens used with next/navigation: push, replace, back. */
export function useRouter() {
  const { navigate } = useRouterState();
  return useMemo(
    () => ({
      push: (href: string) => navigate(href),
      replace: (href: string) => navigate(href, { replace: true }),
      back: () => window.history.back(),
    }),
    [navigate],
  );
}

/** The app path, e.g. "/templates/t-1" (without the mount point); "" before the browser URL is known. */
export const usePathname = () => useRouterState().loc.path;

export function useSearchParams(): URLSearchParams {
  const { search } = useRouterState().loc;
  return useMemo(() => new URLSearchParams(search), [search]);
}

/** Path parameters of the current screen, e.g. { id } for /templates/[id]. */
export const useParams = <T extends Record<string, string> = Record<string, string>>() => useContext(ParamsCtx) as T;

export const ParamsProvider = ParamsCtx.Provider;

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string; replace?: boolean; prefetch?: boolean };

/** An app link: a real <a> (open in new tab works) that navigates in place on a plain click. */
export function Link({ href, replace, prefetch: _prefetch, onClick, target, ...rest }: LinkProps) {
  const { navigate } = useRouterState();
  const full = appHref(href);
  function click(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if ((target && target !== "_self") || !href.startsWith("/") || href.startsWith("//")) return;
    e.preventDefault();
    navigate(href, { replace });
  }
  return <a {...rest} href={full} target={target} onClick={click} />;
}
export default Link;

/* ---- route matching ------------------------------------------------------ */

export interface ScreenRoute {
  /** e.g. "/templates/[id]" */
  pattern: string;
  render: () => ReactNode;
}

export function matchScreen(routes: ScreenRoute[], path: string): { route: ScreenRoute; params: Record<string, string> } | null {
  const segs = path.split("/").filter(Boolean);
  outer: for (const route of routes) {
    const pat = route.pattern.split("/").filter(Boolean);
    if (pat.length !== segs.length) continue;
    const params: Record<string, string> = {};
    for (let i = 0; i < pat.length; i++) {
      // Raw (still URL-encoded) like Next's useParams; the screens decode.
      if (pat[i].startsWith("[")) params[pat[i].slice(1, -1)] = segs[i];
      else if (pat[i] !== segs[i]) continue outer;
    }
    return { route, params };
  }
  return null;
}

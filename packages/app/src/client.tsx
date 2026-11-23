"use client";
/**
 * labebal's screens as one React component, for any React 18/19 app.
 *
 *   import { LabebalApp } from "@labebal/app";
 *   <LabebalApp basePath="/labels" />   // render it for every path under /labels
 *
 * The server side (`@labebal/app/server`) must answer `${basePath}/api/*`.
 */
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setFontBase, setLabelUrlBase } from "@labebal/core";
import { AppShell } from "./components/app-shell";
import { DialogHost } from "./components/dialogs";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { FontsProvider } from "./features/fonts/FontsProvider";
import { LabelUrlSync } from "./features/label-page/LabelUrlSync";
import { NetPrintersSync } from "./features/netprinters/api";
import { PrintFormHost } from "./features/print-form/PrintFormHost";
import { CalibrationSync } from "./features/printers/calibrations";
import { SettingsSync } from "./features/settings/sync";
import { apiRoot, appBase, setBasePath } from "./lib/base";
import { matchScreen, ParamsProvider, RouterProvider, usePathname, type RouterAdapter, type ScreenRoute } from "./lib/router";
import { PortalContainerProvider } from "./lib/portal";
import { cn } from "./lib/utils";

export type { RouterAdapter };

/* Each screen is its own chunk, like the pages of the standalone app. */
const Workspace = lazy(() => import("./features/labels/Workspace").then((m) => ({ default: m.Workspace })));
const QuickPrint = lazy(() => import("./features/quick/QuickPrint").then((m) => ({ default: m.QuickPrint })));
const TemplatesPage = lazy(() => import("./features/templates/TemplatesPage").then((m) => ({ default: m.TemplatesPage })));
const EditorPage = lazy(() => import("./features/editor/EditorPage").then((m) => ({ default: m.EditorPage })));
const DataPage = lazy(() => import("./features/data/DataPage").then((m) => ({ default: m.DataPage })));
const BoardsPage = lazy(() => import("./features/boards/BoardsPage").then((m) => ({ default: m.BoardsPage })));
const RunsPage = lazy(() => import("./features/runs/RunsPage").then((m) => ({ default: m.RunsPage })));
const HistoryPage = lazy(() => import("./features/history/HistoryPage").then((m) => ({ default: m.HistoryPage })));
const InboxPage = lazy(() => import("./features/inbox/InboxPage").then((m) => ({ default: m.InboxPage })));
const MockupsPage = lazy(() => import("./features/mockups/MockupsPage").then((m) => ({ default: m.MockupsPage })));
const SettingsPage = lazy(() => import("./features/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const LabelPage = lazy(() => import("./features/label-page/LabelPage").then((m) => ({ default: m.LabelPage })));

const SCREENS: ScreenRoute[] = [
  { pattern: "/", render: () => <Workspace /> },
  { pattern: "/quick", render: () => <QuickPrint /> },
  { pattern: "/templates", render: () => <TemplatesPage /> },
  { pattern: "/templates/[id]", render: () => <EditorPage /> },
  { pattern: "/components/[id]", render: () => <EditorPage kind="component" /> },
  { pattern: "/data", render: () => <DataPage /> },
  { pattern: "/boards", render: () => <BoardsPage /> },
  { pattern: "/boards/[id]", render: () => <BoardsPage /> },
  { pattern: "/runs", render: () => <RunsPage /> },
  { pattern: "/history", render: () => <HistoryPage /> },
  { pattern: "/inbox", render: () => <InboxPage /> },
  { pattern: "/mockups", render: () => <MockupsPage /> },
  { pattern: "/settings", render: () => <SettingsPage /> },
  { pattern: "/l/[id]", render: () => <LabelPage /> },
];

function Screen() {
  const path = usePathname();
  if (!path) return <p className="m-auto text-muted-foreground">Loading…</p>;
  const hit = matchScreen(SCREENS, path);
  if (!hit) return <p className="m-auto text-muted-foreground">Nothing here. Check the address.</p>;
  return (
    <ParamsProvider value={hit.params}>
      {/* key: a fresh screen per route (and per id), like separate pages. */}
      <Suspense key={path} fallback={<p className="m-auto text-muted-foreground">Loading…</p>}>
        {hit.route.render()}
      </Suspense>
    </ParamsProvider>
  );
}

export interface LabebalAppProps {
  /** Where the module is mounted, e.g. "/labels" (default: site root). Render <LabebalApp> for every path below it. */
  basePath?: string;
  /** Send navigation through the host's router instead of the History API. */
  router?: RouterAdapter;
  /**
   * "full" (default): labebal's header with its name and the signed-in user.
   * "embedded": the same navigation without labebal's name and user badge
   * (the host shows its own).
   */
  chrome?: "full" | "embedded";
  /** Classes for the outer box, e.g. its height. Without it the box is 100dvh tall (full) or fills its parent (embedded). */
  className?: string;
  /** URL of a service worker to register for offline use (the standalone app serves "/sw.js"). */
  serviceWorker?: string;
  /** Share the host's TanStack Query client (default: labebal's own). */
  queryClient?: QueryClient;
  /** The app path to render on the server (SSR); in the browser the URL decides. */
  initialPath?: string;
  /**
   * Light or dark. Default: follow the host (a "dark" class on <html> or any
   * ancestor, which is what most theme switchers set). "system" follows the
   * device setting.
   */
  colorScheme?: "light" | "dark" | "system";
}

/** "dark" class for the labebal box from the colorScheme prop (undefined = follow the host). */
function useDarkClass(scheme: LabebalAppProps["colorScheme"]): boolean {
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    if (scheme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const read = () => setSystemDark(mq.matches);
    read();
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, [scheme]);
  return scheme === "dark" || (scheme === "system" && systemDark);
}

export function LabebalApp({ basePath, router, chrome = "full", className, serviceWorker, queryClient, initialPath, colorScheme }: LabebalAppProps) {
  // Set before the first child renders: every link and API URL reads it.
  setBasePath(basePath);
  setFontBase(`${apiRoot()}/static`);
  const [own] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }));
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  const dark = useDarkClass(colorScheme);
  useEffect(() => {
    // Label QR codes point at this mount unless the server has a public URL (LabelUrlSync).
    if (appBase()) setLabelUrlBase(`${window.location.origin}${appBase()}`);
  }, [basePath]);
  return (
    // Sizing default is an inline style: the prebuilt stylesheet only styles what is inside .labebal.
    <div className={cn("labebal bg-background text-foreground", dark && "dark", className)} style={className ? undefined : { height: chrome === "full" ? "100dvh" : "100%" }}>
      <PortalContainerProvider value={portal}>
        <LabebalProviders queryClient={queryClient ?? own}>
          <RouterProvider adapter={router} initialPath={initialPath}>
            <AppShell chrome={chrome} serviceWorker={serviceWorker}>
              <Screen />
            </AppShell>
          </RouterProvider>
        </LabebalProviders>
      </PortalContainerProvider>
      {/* Dialogs, menus and tooltips render here (see lib/portal.tsx). */}
      <div ref={setPortal} data-labebal-portals="" />
    </div>
  );
}

function LabebalProviders({ queryClient, children }: { queryClient: QueryClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <FontsProvider>{children}</FontsProvider>
      </TooltipProvider>
      <Toaster />
      <DialogHost />
      <PrintFormHost />
      <CalibrationSync />
      <LabelUrlSync />
      <SettingsSync />
      <NetPrintersSync />
    </QueryClientProvider>
  );
}

"use client";
import { Suspense } from "react";
import { Link } from "../lib/router";
import { usePathname } from "../lib/router";
import {
  IconCloudOff,
  IconDeviceMobile,
  IconDatabase,
  IconHistory,
  IconInbox,
  IconLayoutDashboard,
  IconLayoutGrid,
  IconPackages,
  IconPhoto,
  IconPrinter,
  IconSettings,
} from "@tabler/icons-react";
import { cn } from "../lib/utils";
import { Logo } from "./logo";
import { PrinterStatus } from "../features/labels/Toolbar";
import { InboxBadge } from "../features/inbox/InboxBadge";
import { ScanButton } from "../features/scan/ScanDialog";
import { UserBadge } from "../features/auth/me-client";
import { PwaSetup, useOnline } from "../features/pwa/PwaSetup";
import { usePendingHistory } from "../features/pwa/history-queue";
import { PackUpdateNotice } from "../features/packs/UpdateNotice";

/** App navigation. Each entry is owned by one feature folder. */
export const NAV = [
  { href: "/", label: "Print", icon: IconPrinter },
  { href: "/quick", label: "Quick print", icon: IconDeviceMobile },
  { href: "/boards", label: "Boards", icon: IconLayoutDashboard },
  { href: "/templates", label: "Templates", icon: IconLayoutGrid },
  { href: "/data", label: "Data", icon: IconDatabase },
  { href: "/runs", label: "Stock runs", icon: IconPackages },
  { href: "/history", label: "History", icon: IconHistory },
  { href: "/inbox", label: "Inbox", icon: IconInbox },
  { href: "/mockups", label: "Mockups", icon: IconPhoto },
  { href: "/settings", label: "Settings", icon: IconSettings },
] as const;

/** Nav links; reads the pathname, so it sits in a Suspense boundary (dynamic routes can't prerender it). */
function NavLinks({ path }: { path: string | null }) {
  const active = (href: string) => path !== null && (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <>
      {NAV.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={active(href) ? "page" : undefined}
          title={label}
          aria-label={label}
          className={cn(
            "relative flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground",
            active(href) && "bg-accent text-foreground",
            // Phones get the highlighted "Quick print" chip instead (see AppShell).
            href === "/quick" && "hidden md:flex",
          )}
        >
          <Icon className="size-4" aria-hidden />
          {/* When the names don't fit: icons, with the current page named. */}
          <span className={cn(!active(href) && "hidden @[52rem]:inline")}>{label}</span>
          {href === "/inbox" && <InboxBadge />}
        </Link>
      ))}
    </>
  );
}

function ActiveNavLinks() {
  return <NavLinks path={usePathname()} />;
}

/** Printer status; /quick has its own big printer card, so phones don't get it twice. */
function HeaderPrinter() {
  const quick = usePathname()?.startsWith("/quick");
  return (
    <div className={cn("min-w-0", quick && "hidden md:block")}>
      <PrinterStatus />
    </div>
  );
}

/** Offline and "prints waiting to be recorded" indicator. */
function ConnectivityBadge() {
  const online = useOnline();
  const pending = usePendingHistory();
  if (online && !pending) return null;
  return (
    <span
      role="status"
      className="flex shrink-0 items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-xs text-amber-800 dark:text-amber-300"
      title={online ? "Sending print history recorded while offline" : "Offline: printing still works; history is sent when you are back online"}
    >
      <IconCloudOff className="size-3.5" aria-hidden />
      {online ? "Syncing" : "Offline"}
      {pending > 0 && ` · ${pending} print${pending > 1 ? "s" : ""} to record`}
    </span>
  );
}

export function AppShell({ children, chrome = "full", serviceWorker }: { children: React.ReactNode; chrome?: "full" | "embedded"; serviceWorker?: string }) {
  const full = chrome === "full";
  return (
    <div className="flex h-full flex-col">
      <a href="#main" className="sr-only z-50 rounded-md bg-background px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:ring-2 focus:ring-ring">
        Skip to content
      </a>
      <PwaSetup serviceWorker={serviceWorker} />
      <header className="flex items-center gap-2 border-b bg-card px-2 py-2 sm:gap-4 sm:px-4">
        {full && (
          <div className="flex shrink-0 items-center gap-1.5">
            <Link href="/" className="flex items-center" aria-label="labebal home">
              <Logo className="size-7" />
            </Link>
            <div className="hidden min-w-0 flex-col leading-tight sm:flex">
              <Link href="/" className="font-semibold">
                labebal
              </Link>
              <UserBadge compact className="flex items-center gap-1 text-[11px] text-muted-foreground" />
            </div>
          </div>
        )}
        {/* Phones and tablets: the touch-friendly print view. */}
        <Link href="/quick" className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-sm text-primary-foreground md:hidden">
          <IconDeviceMobile className="size-4" aria-hidden /> Quick print
        </Link>
        <nav aria-label="Main" className="@container flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          <Suspense fallback={<NavLinks path={null} />}>
            <ActiveNavLinks />
          </Suspense>
        </nav>
        <ScanButton />
        <ConnectivityBadge />
        <Suspense fallback={<PrinterStatus />}>
          <HeaderPrinter />
        </Suspense>
      </header>
      <main id="main" className="flex min-h-0 flex-1 flex-col">
        {children}
      </main>
      {/* Pack updates (admins): reads the pathname, so under Suspense like the nav. */}
      <Suspense>
        <PackUpdateNotice />
      </Suspense>
    </div>
  );
}

/** Standard page frame for non-workspace pages. */
export function Page({ title, actions, children, className }: { title: string; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={cn("mx-auto max-w-6xl space-y-6 p-6", className)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">{title}</h1>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function ComingSoon({ what }: { what: string }) {
  return <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">{what} is being built.</p>;
}

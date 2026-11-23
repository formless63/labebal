"use client";
import { useInboxCount } from "./api";

/** Pending print requests, next to the Inbox nav link. */
export function InboxBadge() {
  const n = useInboxCount().data?.pending ?? 0;
  if (!n) return null;
  return (
    <span className="ml-0.5 rounded-full bg-primary px-1.5 text-[10px] leading-4 font-semibold text-primary-foreground" aria-label={`${n} waiting`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

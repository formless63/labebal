"use client";
/** The current user (from /api/me) and role checks for the UI. */
import { useQuery } from "@tanstack/react-query";
import { IconUserCircle } from "@tabler/icons-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { OPEN_IDENTITY, ROLE_HELP, roleAtLeast, type Identity, type Role } from "./identity";
import { apiRoot } from "../../lib/base";

export const ME_KEY = ["me"] as const;

export function useMe(): Identity {
  const q = useQuery({
    queryKey: ME_KEY,
    queryFn: () => fetch(`${apiRoot()}/me`).then((r) => (r.ok ? (r.json() as Promise<Identity>) : OPEN_IDENTITY)),
    staleTime: 5 * 60_000,
    retry: false,
  });
  // Until known (or when it can't be loaded) behave as before: everything allowed.
  // The API enforces roles anyway; this only hides controls.
  return q.data ?? OPEN_IDENTITY;
}

/** True when the current user has at least this role. */
export const useCan = (need: Role) => roleAtLeast(useMe().role, need);

/** Renders children only for users with at least `need` (or `fallback`). */
export function RoleGate({ need, children, fallback = null }: { need: Role; children: React.ReactNode; fallback?: React.ReactNode }) {
  return useCan(need) ? children : fallback;
}

/** Settings > You: who the proxy says you are (history uses this instead of the browser name). */
export function IdentityNote() {
  const me = useMe();
  if (!me.enabled) return null;
  return (
    <p className="text-sm text-muted-foreground">
      {me.signedIn ? (
        <>
          Signed in as <b className="text-foreground">{me.display}</b>
          {me.email && me.email !== me.display ? ` (${me.email})` : ""}, role <b className="text-foreground">{me.role}</b>
          {me.groups.length > 0 && <> · groups: {me.groups.join(", ")}</>}. Prints are recorded under this name; the name below is only used when you are not signed in.
        </>
      ) : (
        <>Not signed in through the proxy (role {me.role}). Prints use the name below.</>
      )}
    </p>
  );
}

/** Signed-in user and role, for the app header (nothing when identity is off). */
export function UserBadge({ className, compact }: { className?: string; compact?: boolean }) {
  const me = useMe();
  if (!me.enabled || !me.signedIn) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={className ?? "flex shrink-0 items-center gap-1 text-sm text-muted-foreground"} tabIndex={0} aria-label={`Signed in as ${me.display}, role ${me.role}`}>
          {!compact && <IconUserCircle className="size-4" aria-hidden />}
          <span className={compact ? "max-w-40 truncate" : "max-w-32 truncate"}>{me.display}</span>
          {me.role !== "admin" && <span className="rounded bg-muted px-1 text-[10px] uppercase">{me.role}</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent className="block max-w-72">
        <p>
          Signed in as {me.display}
          {me.email && me.email !== me.display ? ` (${me.email})` : ""}. Role: {me.role}.
        </p>
        <p className="opacity-80">{ROLE_HELP[me.role]}</p>
      </TooltipContent>
    </Tooltip>
  );
}

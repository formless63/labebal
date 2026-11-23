"use client";
/**
 * Keeps team settings (custom sizes, learned rolls, darkness presets, printer
 * model defaults and profiles, roll usage, empty library folders, team
 * values for {{team:name}}) and the signed-in person's own settings (favourites, pins, open folders, icon
 * favourites / recents) on the server. The stores stay the working copy; see
 * engine.ts for how changes travel. Mounted once in the app providers.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { getWho } from "../history/who";
import { onIconPrefsChange, readIconPrefs, setIconPrefs } from "../icons/prefs";
import { setTeamValues } from "@labebal/core";
import { useLabelStore } from "../labels/store";
import { useLibraryPrefs } from "../library/folders";
import { usePrinterStore, type ModelDefaults, type SavedPrinter } from "../printers/store";
import { SettingsSyncEngine, type PatchResult, type SettingsSnapshot } from "./engine";
import { mapToShared, mapToUser, sharedToMap, userToMap, type ScopedOp, type SharedSlices } from "./model";
import { apiRoot } from "../../lib/base";

const STORAGE = { outbox: "labebal:settings-outbox", meta: "labebal:settings-sync" } as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function readShared() {
  const ls = useLabelStore.getState().settings;
  const ps = usePrinterStore.getState();
  return sharedToMap({
    customSizes: ls.customSizes ?? [],
    customMaterials: ls.customMaterials ?? [],
    customRibbons: ls.customRibbons ?? [],
    learnedRolls: ls.learnedRolls ?? {},
    densityPresets: ls.densityPresets ?? {},
    models: ps.models,
    profiles: ps.profiles as SharedSlices["profiles"],
    usage: ps.usage,
    newFolders: useLibraryPrefs.getState().newFolders,
    teamValues: ls.teamValues ?? {},
  });
}

function writeShared(m: Record<string, unknown>) {
  const ps = usePrinterStore.getState();
  const s = mapToShared(m, Object.fromEntries(Object.entries(ps.profiles).map(([k, p]) => [k, p.lastSeen])));
  const ls = useLabelStore.getState().settings;
  const labelPatch = { customSizes: s.customSizes, customMaterials: s.customMaterials, customRibbons: s.customRibbons, learnedRolls: s.learnedRolls, densityPresets: s.densityPresets, teamValues: s.teamValues };
  if (
    !same(
      { customSizes: ls.customSizes ?? [], customMaterials: ls.customMaterials ?? [], customRibbons: ls.customRibbons ?? [], learnedRolls: ls.learnedRolls ?? {}, densityPresets: ls.densityPresets ?? {}, teamValues: ls.teamValues ?? {} },
      labelPatch,
    )
  )
    useLabelStore.setState({ settings: { ...ls, ...labelPatch } });
  const printerPatch = { models: s.models as Record<string, ModelDefaults>, profiles: s.profiles as unknown as Record<string, SavedPrinter>, usage: s.usage };
  if (!same({ models: ps.models, profiles: ps.profiles, usage: ps.usage }, printerPatch)) usePrinterStore.setState(printerPatch);
  if (!same(useLibraryPrefs.getState().newFolders, s.newFolders)) useLibraryPrefs.setState({ newFolders: s.newFolders });
}

function readUser() {
  const lib = useLibraryPrefs.getState();
  const icons = readIconPrefs();
  return userToMap({ favourites: lib.favourites, pinned: lib.pinned, openFolders: lib.openFolders, iconFavourites: icons.favourites, iconRecent: icons.recent });
}

function writeUser(m: Record<string, unknown>) {
  const u = mapToUser(m);
  const lib = useLibraryPrefs.getState();
  const patch = { favourites: u.favourites, pinned: u.pinned, openFolders: u.openFolders };
  if (!same({ favourites: lib.favourites, pinned: lib.pinned, openFolders: lib.openFolders }, patch)) useLibraryPrefs.setState(patch);
  setIconPrefs({ favourites: u.iconFavourites, recent: u.iconRecent });
}

function load(n: keyof typeof STORAGE): unknown {
  try {
    return JSON.parse(localStorage.getItem(STORAGE[n]) ?? "null");
  } catch {
    return null;
  }
}

function save(n: keyof typeof STORAGE, v: unknown) {
  try {
    localStorage.setItem(STORAGE[n], JSON.stringify(v));
  } catch {
    // Quota / private mode: the in-memory copy still syncs this session.
  }
}

async function send(ops: ScopedOp[]): Promise<PatchResult> {
  const who = getWho();
  const r = await fetch(`${apiRoot()}/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...(who ? { "x-labebal-who": encodeURIComponent(who) } : {}) },
    body: JSON.stringify({ ops }),
  });
  // A malformed batch would fail forever: report every op as refused so it is dropped.
  if (r.status === 400) return { changed: [], denied: ops.map((o) => ({ scope: o.scope, key: o.key, status: 400, error: "invalid" })) };
  if (!r.ok) throw new Error(`settings: ${r.status}`);
  return r.json();
}

function onDenied(denied: PatchResult["denied"]) {
  const role = denied.find((d) => d.status === 403);
  if (role) toast.warning("Saved in this browser only", { description: `${role.error} Ask an admin to change team settings for everyone.`, id: "settings-denied" });
  for (const d of denied.filter((x) => x.status === 400)) console.warn("settings: refused", d.key, d.error);
}

let engine: SettingsSyncEngine | null = null;
let retry: ReturnType<typeof setTimeout> | undefined;
let attempt = 0;
let pending = false;

function getEngine() {
  if (!engine) engine = new SettingsSyncEngine({ readShared, writeShared, readUser, writeUser, load, save, send, onDenied });
  return engine;
}

/** Send soon (several quick changes go in one request); retried with back-off while offline. */
function schedule(delay = 400) {
  clearTimeout(retry);
  retry = setTimeout(async () => {
    if (pending) return schedule(delay);
    pending = true;
    const ok = await getEngine().flush();
    pending = false;
    if (ok) attempt = 0;
    else if (getEngine().ready && getEngine().outbox.length) schedule(Math.min(60_000, 2000 * 2 ** attempt++));
  }, delay);
}

function onLocalChange() {
  if (getEngine().localChanged() && getEngine().ready) schedule();
}

export function SettingsSync() {
  const q = useQuery({
    queryKey: ["settings"],
    queryFn: async (): Promise<SettingsSnapshot> => {
      const r = await fetch(`${apiRoot()}/settings`, { cache: "no-store" });
      if (!r.ok) throw new Error(`settings: ${r.status}`);
      return r.json();
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: 5 * 60_000,
  });

  // Team values feed {{team:name}} in every render.
  useEffect(() => {
    let last = "";
    const apply = () => {
      const v = useLabelStore.getState().settings.teamValues ?? {};
      const key = JSON.stringify(v);
      if (key !== last) setTeamValues(v);
      last = key;
    };
    apply();
    return useLabelStore.subscribe(apply);
  }, []);

  useEffect(() => {
    const e = getEngine();
    const unsubs = [useLabelStore.subscribe(onLocalChange), usePrinterStore.subscribe(onLocalChange), useLibraryPrefs.subscribe(onLocalChange), onIconPrefsChange(onLocalChange)];
    const online = () => e.ready && schedule(0);
    window.addEventListener("online", online);
    return () => {
      unsubs.forEach((u) => u());
      window.removeEventListener("online", online);
    };
  }, []);

  useEffect(() => {
    if (!q.data) return;
    getEngine().applySnapshot(q.data);
    schedule(0);
  }, [q.data]);

  return null;
}

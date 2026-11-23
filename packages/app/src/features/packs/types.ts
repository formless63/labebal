/** Pack data shared by server and browser (no server-only imports). */
import type { Label, Library, Template } from "@labebal/core";
import type { PackListing } from "../../db/schema";

export type { PackListing };

/** Which library items belong to which pack (sent with GET /api/library). */
export interface PackOverlay {
  packs: { id: string; name: string; version: string; enabled: boolean }[];
  /** `template:<id>` / `label:<id>` -> owning pack + whether it was changed here. */
  items: Record<string, { pack: string; changed: boolean }>;
}

export type LibraryWithPacks = Library & { packs?: PackOverlay };

export interface PackSourceView {
  id: string;
  kind: "url" | "builtin";
  input: string;
  url: string;
  name: string;
  hasToken: boolean;
  tokenHost: string;
  /** Read through the GitHub API with this connected account (login only; no token). */
  account: { id: string; login: string } | null;
  lastFetchedAt: string | null;
  lastError: string | null;
  index: {
    kind: string;
    name?: string;
    description?: string;
    packs: PackListing[];
    errors: { url: string; error: string }[];
  } | null;
}

export interface InstalledPackView {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  homepage: string;
  enabled: boolean;
  sourceId: string | null;
  url: string;
  selection: string[] | null;
  installedAt: string;
  updatedAt: string;
  counts: { templates: number; labels: number; datasets: number; assets: number };
  /** Items edited here (kept on update; "reset to pack version" restores them). */
  changed: { kind: string; id: string; name: string }[];
  /** Items deleted here (not brought back by updates). */
  deleted: { kind: string; id: string; name: string }[];
  /** Newer version offered by its source (after the last refresh). */
  available: string | null;
  /** Version the admin chose to skip in update prompts. */
  skipped: string | null;
  /** Labels outside the pack that use its templates (hidden while it is disabled). */
  dependents: number;
}

export interface PacksView {
  sources: PackSourceView[];
  installed: InstalledPackView[];
}

export interface SyncResult {
  pack: { id: string; name: string; version: string };
  inserted: number;
  updated: number;
  unchanged: number;
  adopted: number;
  kept: { kind: string; id: string; name: string }[];
  conflicts: { kind: string; id: string; owner: string }[];
  removed: number;
  detached: number;
  warnings: string[];
}

export interface RemovePlanView {
  pack: { id: string; name: string };
  remove: number;
  changed: { kind: string; id: string; name: string; reason: "changed" | "used" }[];
  /** Labels outside the pack using templates that would be deleted with it. */
  dependents: number;
}

/** One template / label an update would add, remove or change (dry run). */
export interface UpdateItemView {
  kind: "template" | "label";
  id: string;
  name: string;
  /** kept: "changed" (you changed it, the pack did too) or "removed" (gone from the pack, kept as yours). */
  reason?: "changed" | "removed";
  /** Preview only: the library's version and the pack's new version. */
  before?: Template | Label | null;
  after?: Template | Label | null;
}

/** Update prompt for one installed pack (POST /api/packs/check-updates). */
export interface PackUpdateSummary {
  packId: string;
  name: string;
  from: string;
  to: string;
  sourceId: string | null;
  sourceName: string;
  enabled?: boolean;
  added: UpdateItemView[];
  removed: UpdateItemView[];
  changed: UpdateItemView[];
  /** Kept because you changed it. */
  kept: UpdateItemView[];
}

/** Review dialog data: the summary with documents, plus templates label previews need. */
export interface PackUpdatePreview extends PackUpdateSummary {
  templates?: Record<string, Template>;
  templatesBefore?: Record<string, Template>;
}

export const itemLabel =(kind: string) => ({ template: "template", label: "label", dataset: "dataset", asset: "file" })[kind] ?? kind;
export type { Template };

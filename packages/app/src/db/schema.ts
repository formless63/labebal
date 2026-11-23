/**
 * Drizzle schema. Runs on PGlite (standalone container) and on real Postgres
 * unchanged. Documents are stored as JSONB so the label model can
 * evolve without migrations; columns exist for what we query/sort by.
 */
import { bigint, boolean, customType, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { CounterReset, CounterScope, DataColumn, DataRow, DatasetLink, Label, LabelComponent, LabelNode, ReservedRange, Template, TextStyle } from "@labebal/core";

export const templates = pgTable("label_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  doc: jsonb("doc").$type<Template>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const labels = pgTable(
  "label_labels",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => templates.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    values: jsonb("values").$type<Label["values"]>().notNull().default({}),
    overrides: jsonb("overrides").$type<Record<string, Partial<LabelNode>>>(),
    invert: boolean("invert"),
    tags: text("tags").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("label_labels_template_idx").on(t.templateId)],
);

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (v) => Buffer.from(v),
});

/** Uploaded binary assets: images used in labels, user fonts, custom SVG icons. */
export const assets = pgTable("label_assets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").$type<"image" | "font" | "icon">().notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  data: bytea("data").notNull(),
  /** Kind-specific metadata, e.g. fonts: { family, pixel?: { pxPerEm, linePx } }. */
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Tables of records that drive labels (CSV imports, pastes, API pushes). Rows live in `label_dataset_rows`. */
export const datasets = pgTable("label_datasets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  columns: jsonb("columns").$type<DataColumn[]>().notNull().default([]),
  /** Template + column mapping + rules (null until linked). */
  link: jsonb("link").$type<DatasetLink>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One row of a dataset. `id` is the stable row key (`r-...`, unique within the
 * dataset); `position` orders rows (gaps allowed); `cells` maps column id ->
 * text (a missing cell reads as "").
 */
export const datasetRows = pgTable(
  "label_dataset_rows",
  {
    datasetId: text("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    position: integer("position").notNull(),
    cells: jsonb("cells").$type<DataRow["values"]>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.datasetId, t.id] }), index("label_dataset_rows_position_idx").on(t.datasetId, t.position)],
);

export interface RunItem {
  labelId: string;
  qty: number;
}

/** Stock runs: saved presets of label x quantity. */
export const runs = pgTable("label_runs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  notes: text("notes").notNull().default(""),
  items: jsonb("items").$type<RunItem[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One button on a Quick print board: this label, printed at this size, this many at a time. */
export interface BoardTile {
  labelId: string;
  sizeId: string;
  qty: number;
}

/** Quick print boards: a saved set of labels (each at its own size) that print with one tap. */
export const boards = pgTable("label_boards", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  notes: text("notes").notNull().default(""),
  tiles: jsonb("tiles").$type<BoardTile[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export interface HistoryItem {
  labelId: string;
  name: string;
  templateId: string;
  templateName?: string;
  qty: number;
  invert: boolean;
  /* snapshot of what was printed (all optional: older entries lack them). */
  /** Resolved field values (label values + template rules). */
  values?: Record<string, string>;
  overrides?: Record<string, Partial<LabelNode>>;
  /** Template version (label_template_versions.version) the label was printed with. */
  templateVersion?: number;
  /** Small 1-bit PNG of the printed image (data URL); only for the first items of big jobs. */
  thumb?: string;
}

/** One row per print job sent from a browser. Names are copied so history survives deletes. */
export const printHistory = pgTable(
  "label_print_history",
  {
    id: text("id").primaryKey(),
    printedAt: timestamp("printed_at", { withTimezone: true }).notNull().defaultNow(),
    /** "queue", "label", "run:<id>", "dataset:<id>", ... */
    source: text("source").notNull().default(""),
    printer: text("printer").notNull(),
    sizeId: text("size_id").notNull(),
    sizeName: text("size_name").notNull(),
    material: text("material").notNull(),
    ribbon: text("ribbon").notNull(),
    density: integer("density"),
    invertAll: boolean("invert_all").notNull().default(false),
    totalQty: integer("total_qty").notNull(),
    items: jsonb("items").$type<HistoryItem[]>().notNull(),
    /** Short browser/OS summary, e.g. "Chrome 142 on Windows". */
    client: text("client").notNull().default(""),
    /** Person who printed: the name set in this browser (Settings > You); "" when not set. */
    who: text("who").notNull().default(""),
    /** counter numbers reserved for this print. */
    counters: jsonb("counters").$type<ReservedRange[]>(),
    /** print-time form answers, template id -> field key -> value. */
    printValues: jsonb("print_values").$type<Record<string, Record<string, string>>>(),
    /** how the run ended (status done/cancelled/failed, printed, total, nextLabel, printer, label type, print task). */
    outcome: jsonb("outcome").$type<Record<string, unknown>>(),
    /* a voided entry (mis-print, wrong roll...) is kept but marked. */
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason").notNull().default(""),
    voidedBy: text("voided_by").notNull().default(""),
  },
  (t) => [index("label_print_history_printed_idx").on(t.printedAt)],
);

/** Bearer tokens for the public /api/v1 API. Only a SHA-256 hash is stored. */
export const apiTokens = pgTable(
  "label_api_tokens",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** First characters of the token, shown in the list to tell tokens apart. */
    prefix: text("prefix").notNull(),
    hash: text("hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("label_api_tokens_hash_idx").on(t.hash)],
);

/* ======================================================================= */
/* counters (persistent numbering). Logic: packages/core/src/counters.ts, */
/* repository: src/server/counters.ts.                                      */
/* ======================================================================= */

/** Counter definitions; `id` is what templates write in `{{counter:id}}`. */
export const counters = pgTable("label_counters", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  scope: text("scope").$type<CounterScope>().notNull().default("global"),
  /** Scope "value": field key whose value picks the sequence. */
  keyField: text("key_field"),
  reset: text("reset").$type<CounterReset>().notNull().default("never"),
  /** Reset "change": field key whose value change restarts the counter. */
  watchField: text("watch_field"),
  start: integer("start").notNull().default(1),
  format: text("format").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Running value per counter + scope key ("" global, template id, or template id + "/" + field value). */
export const counterValues = pgTable(
  "label_counter_values",
  {
    counterId: text("counter_id")
      .notNull()
      .references(() => counters.id, { onDelete: "cascade" }),
    scopeKey: text("scope_key").notNull().default(""),
    /** Next number to hand out. */
    next: integer("next").notNull(),
    /** Reset period of the stored value (e.g. "2026-11-19"), "" for never / on change. */
    period: text("period").notNull().default(""),
    /** Last watched field value (reset "change"). */
    watched: text("watched"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.counterId, t.scopeKey] })],
);

/** Every block of numbers handed out (browser prints and the API). */
export const counterLog = pgTable(
  "label_counter_log",
  {
    id: text("id").primaryKey(),
    counterId: text("counter_id")
      .notNull()
      .references(() => counters.id, { onDelete: "cascade" }),
    scopeKey: text("scope_key").notNull().default(""),
    first: integer("first").notNull(),
    last: integer("last").notNull(),
    /** "print:queue", "api:<token name>", "manual" ... */
    source: text("source").notNull().default(""),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("label_counter_log_counter_idx").on(t.counterId, t.at)],
);
/* ========================================================== end counters */
/* ------------------------------------------------------------------------
 * data in / out: live data sources, print inbox, outgoing webhooks.
 * ---------------------------------------------------------------------- */

export interface SourceFieldMap {
  column: string;
  path: string;
}

/** A dataset's live link to a CSV URL / Google Sheet / JSON API (at most one per dataset). */
export const dataSources = pgTable("label_data_sources", {
  datasetId: text("dataset_id")
    .primaryKey()
    .references(() => datasets.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"csv" | "json">().notNull(),
  url: text("url").notNull(),
  /** Optional request header (e.g. Authorization: Bearer ...). Stored as given; never returned to the browser. */
  headerName: text("header_name"),
  headerValue: text("header_value"),
  /** JSON only: where the row objects are (`$.data.items[*]`), and column <- path mapping. */
  rowsPath: text("rows_path"),
  fields: jsonb("fields").$type<SourceFieldMap[]>().notNull().default([]),
  /** Column (name) to match rows on; without one each sync replaces all rows. */
  keyColumn: text("key_column"),
  /** "upsert" (by key) or "replace" (delete all rows, insert fresh). */
  mode: text("mode").$type<"upsert" | "replace">().notNull().default("upsert"),
  /** Re-create / update the dataset's labels after a sync. */
  applyLabels: boolean("apply_labels").notNull().default(false),
  /** Auto-sync every N minutes while the server runs (null = manual only). */
  intervalMinutes: integer("interval_minutes"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastStatus: text("last_status").$type<"ok" | "error">(),
  lastError: text("last_error"),
  lastResult: jsonb("last_result").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Print requests from other systems (POST /api/v1/print-requests), approved or rejected in a browser. */
export const printRequests = pgTable(
  "label_print_requests",
  {
    id: text("id").primaryKey(),
    status: text("status").$type<"pending" | "approved" | "rejected">().notNull().default("pending"),
    /** An existing label, or (templateId + values) to create one on approval. */
    labelId: text("label_id"),
    templateId: text("template_id"),
    key: text("key"),
    name: text("name"),
    values: jsonb("values").$type<Record<string, string>>(),
    qty: integer("qty").notNull().default(1),
    note: text("note").notNull().default(""),
    requestedBy: text("requested_by").notNull().default(""),
    /** Name of the API token that sent it. */
    tokenName: text("token_name").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: text("decided_by").notNull().default(""),
    reason: text("reason").notNull().default(""),
  },
  (t) => [index("label_print_requests_status_idx").on(t.status, t.createdAt)],
);

/** Outgoing webhook endpoints. */
export const webhooks = pgTable("label_webhooks", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default(""),
  url: text("url").notNull(),
  /** HMAC-SHA256 signing secret. */
  secret: text("secret").notNull(),
  /** Events to send; empty = all. */
  events: text("events").array().notNull().default([]),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One delivery (and its retries) of an event to a webhook. */
export const webhookDeliveries = pgTable(
  "label_webhook_deliveries",
  {
    id: text("id").primaryKey(),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<"pending" | "ok" | "failed">().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    responseStatus: integer("response_status"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => [index("label_webhook_deliveries_due_idx").on(t.status, t.nextAttemptAt), index("label_webhook_deliveries_hook_idx").on(t.webhookId, t.createdAt)],
);
/* ------------------------------------------------------- end tables */
/* ======================================================================
 * Library, history and backup. Also: void columns on
 * label_print_history and snapshot fields on HistoryItem (marked above).
 * ====================================================================== */

/**
 * Snapshots of a template document. Saves within one editing session update
 * the newest automatic snapshot; a new session (or "Save version") starts a
 * new one, so the list stays short. `version` counts up per template.
 */
export const templateVersions = pgTable(
  "label_template_versions",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => templates.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    /** Template name at the time. */
    name: text("name").notNull(),
    doc: jsonb("doc").$type<Template>().notNull(),
    /** Name given with "Save version"; "" for automatic snapshots. */
    note: text("note").notNull().default(""),
    /** Still rolling with the current editing session; false once named, restored or printed with. */
    auto: boolean("auto").notNull().default(true),
    who: text("who").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("label_template_versions_template_version_idx").on(t.templateId, t.version)],
);

/* Printer calibration, saved per physical printer (serial) so every browser uses it. */
export const printerCalibrations = pgTable("label_printer_calibrations", {
  serial: text("serial").primaryKey(),
  model: text("model").notNull(),
  name: text("name").notNull().default(""),
  /** Dots: +x moves the print right, +y moves it down. */
  offsetX: integer("offset_x").notNull().default(0),
  offsetY: integer("offset_y").notNull().default(0),
  /** "calibrated" (checked with a test print) or "suggested" (model default accepted). */
  source: text("source").notNull().default("calibrated"),
  updatedBy: text("updated_by").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ======================================================================
 * Label pages (/l/<id>): free-text notes per label, edited by editors.
 * ====================================================================== */

/** Notes shown on a label's page (what's in the drawer, where to reorder...). One row per label. */
export const labelNotes = pgTable("label_notes", {
  labelId: text("label_id")
    .primaryKey()
    .references(() => labels.id, { onDelete: "cascade" }),
  notes: text("notes").notNull().default(""),
  updatedBy: text("updated_by").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
/* ------------------------------------------------------ end label pages */
/* Settings: shared by the team (scope "shared") or one signed-in person
   ("user:<id>"): custom sizes, learned rolls, printer profiles, roll usage,
   favourites... One row per entry; key families, validation and merge rules
   live in features/settings/model.ts. */
export const settings = pgTable(
  "label_settings",
  {
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by").notNull().default(""),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] })],
);
/* /settings */

/* ======================================================================
 * Library parts: shared text styles and reusable components (editor).
 * Documents are the plain JSON shapes from core schema.ts (`TextStyle`,
 * `LabelComponent`), keyed by their `id`; templates refer to them by id.
 * ====================================================================== */

/** Named text styles (`TextNode.style` refers to `id`). */
export const textStyles = pgTable("label_text_styles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  doc: jsonb("doc").$type<TextStyle>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Reusable components (`ComponentNode.ref` refers to `id`). */
export const components = pgTable("label_components", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  doc: jsonb("doc").$type<LabelComponent>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
/* ------------------------------------------------------- end library parts */

/* ======================================================================
 * Packs: shareable template / label sets installed from sources (git repos,
 * URLs, the built-in Examples). Logic: packages/core/src/pack.ts,
 * repository: src/server/packs.ts. Library rows keep their own tables;
 * membership lives in label_pack_items (no columns on existing tables).
 * ====================================================================== */

/** Cached listing of a source: the packs it offers (no binaries). */
export interface PackSourceIndex {
  kind: "manifest" | "collection" | "bundle" | "collection-bundle";
  name?: string;
  description?: string;
  packs: PackListing[];
  /** Per-pack load errors (the rest of the source still lists). */
  errors: { url: string; error: string }[];
}

export interface PackListing {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  folder?: string;
  /** Manifest / bundle URL (entries of a collection bundle end in #n). */
  url: string;
  counts: { templates: number; labels: number; datasets: number; assets: number; fonts: number };
  /** For previews and "pick labels" (small: no binaries). */
  templates: Template[];
  labels: Label[];
  warnings: string[];
}

/** Where packs come from. `token` (private repos) never leaves the server. */
export const packSources = pgTable("label_pack_sources", {
  id: text("id").primaryKey(),
  /** "url" (manifest / collection / bundle / GitHub shorthand) or "builtin" (shipped with the app). */
  kind: text("kind").$type<"url" | "builtin">().notNull().default("url"),
  /** What was typed: a URL or owner/repo[/path][@ref]. */
  input: text("input").notNull(),
  /** Resolved URL that answered last (manifest / collection / bundle). */
  url: text("url").notNull().default(""),
  name: text("name").notNull().default(""),
  /** Bearer token, sent only to `tokenHost`. */
  token: text("token"),
  tokenHost: text("token_host").notNull().default(""),
  index: jsonb("index").$type<PackSourceIndex>(),
  lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Installed packs. */
export const packs = pgTable("label_packs", {
  /** The manifest id. */
  id: text("id").primaryKey(),
  sourceId: text("source_id").references(() => packSources.id, { onDelete: "set null" }),
  /** Manifest / bundle URL it was installed from. */
  url: text("url").notNull().default(""),
  name: text("name").notNull(),
  version: text("version").notNull(),
  description: text("description").notNull().default(""),
  author: text("author").notNull().default(""),
  homepage: text("homepage").notNull().default(""),
  /** Disabled packs' templates and labels are hidden from the library (not deleted). */
  enabled: boolean("enabled").notNull().default(true),
  /** Label ids picked at install (null = all; then new labels arrive with updates). */
  selection: text("selection").array(),
  installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Library items that belong to a pack. `doc` / `hash` are the pack's version
 * (what "reset to pack version" restores); the item is "changed here" when the
 * library row's hash differs. Assets keep only the hash (bytes are in label_assets).
 */
export const packItems = pgTable(
  "label_pack_items",
  {
    packId: text("pack_id")
      .notNull()
      .references(() => packs.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"template" | "label" | "dataset" | "asset">().notNull(),
    itemId: text("item_id").notNull(),
    hash: text("hash").notNull(),
    doc: jsonb("doc").$type<unknown>(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.itemId] }), index("label_pack_items_pack_idx").on(t.packId)],
);
/* ============================================================= end packs */

/* ======================================================================
 * GitHub: connected accounts, published packs, GitHub-backed sources and
 * skipped pack updates. Logic: src/server/github*.ts, features/github/*.
 * Tokens never leave the server (backups include them, like webhook secrets).
 * ====================================================================== */

/** A connected GitHub account. `scope`: "instance" (no identity) or "user:<id>". */
export const githubAccounts = pgTable(
  "label_github_accounts",
  {
    id: text("id").primaryKey(),
    scope: text("scope").notNull(),
    githubId: bigint("github_id", { mode: "number" }).notNull(),
    login: text("login").notNull(),
    name: text("name").notNull().default(""),
    avatarUrl: text("avatar_url").notNull().default(""),
    /** "app" (Connect GitHub, device flow) or "token" (personal access token). */
    kind: text("kind").$type<"app" | "token">().notNull(),
    token: text("token").notNull(),
    /** Commit e-mail override (default: <id>+<login>@users.noreply.github.com). */
    commitEmail: text("commit_email"),
    /** "owner/repo" where this account's packs are saved by default. */
    defaultRepo: text("default_repo"),
    /** "ok" or "reconnect" (GitHub answered 401: token revoked / expired). */
    status: text("status").$type<"ok" | "reconnect">().notNull().default("ok"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("label_github_accounts_scope_user_idx").on(t.scope, t.githubId, t.kind)],
);

/** A pack published from this app to a GitHub repo (what "Publish update" rebuilds). */
export const githubPublished = pgTable(
  "label_github_published",
  {
    id: text("id").primaryKey(),
    packId: text("pack_id").notNull(),
    accountId: text("account_id").references(() => githubAccounts.id, { onDelete: "set null" }),
    owner: text("owner").notNull(),
    repo: text("repo").notNull(),
    branch: text("branch").notNull(),
    /** Folder in the repo ("" = the repo root, a single-pack repo). */
    dir: text("dir").notNull().default(""),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    author: text("author").notNull().default(""),
    folder: text("folder").notNull().default(""),
    version: text("version").notNull(),
    templateIds: text("template_ids").array().notNull().default([]),
    labelIds: text("label_ids").array().notNull().default([]),
    datasets: boolean("datasets").notNull().default(false),
    /** itemKey -> hash of what was published (to tell "changed since"). */
    items: jsonb("items").$type<Record<string, string>>().notNull().default({}),
    commitSha: text("commit_sha").notNull().default(""),
    commitUrl: text("commit_url").notNull().default(""),
    publishedBy: text("published_by").notNull().default(""),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("label_github_published_repo_idx").on(t.owner, t.repo, t.dir)],
);

/** A pack source read through the GitHub API with a connected account (cheap update checks by commit SHA). */
export const packSourceGithub = pgTable("label_pack_source_github", {
  sourceId: text("source_id")
    .primaryKey()
    .references(() => packSources.id, { onDelete: "cascade" }),
  accountId: text("account_id").references(() => githubAccounts.id, { onDelete: "set null" }),
  owner: text("owner").notNull(),
  repo: text("repo").notNull(),
  /** Branch / tag / commit typed with the source ("HEAD" = default branch). */
  ref: text("ref").notNull().default("HEAD"),
  path: text("path").notNull().default(""),
  /** Commit SHA of `ref` at the last refresh, and the ETag of that answer. */
  sha: text("sha"),
  etag: text("etag"),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
});

/** "Skip this version" for pack update prompts. */
export const packUpdateSkips = pgTable("label_pack_update_skips", {
  packId: text("pack_id").primaryKey(),
  version: text("version").notNull(),
  skippedBy: text("skipped_by").notNull().default(""),
  skippedAt: timestamp("skipped_at", { withTimezone: true }).notNull().defaultNow(),
});
/* ============================================================ end github */

/* ============================================================ network printers */
/**
 * Label printers on the network that the server prints to (ZPL over raw TCP,
 * port 9100). Set up by an admin; the browser sends rendered ZPL through the
 * server, so any browser (phones included) can print to them.
 */
export const netPrinters = pgTable("label_net_printers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  host: text("host").notNull(),
  port: integer("port").notNull().default(9100),
  /** Printer language; only "zpl" so far. */
  language: text("language").notNull().default("zpl"),
  /** What the printer reported (~HI), e.g. "ZD500-200dpi". */
  model: text("model").notNull().default(""),
  dpi: integer("dpi").notNull(),
  /** Full printhead width in dots. */
  headDots: integer("head_dots").notNull(),
  /** "direct", "transfer" or "both" (ribbon optional). */
  thermal: text("thermal").notNull().default("both"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by").notNull().default(""),
});
/* ============================================================ end network printers */

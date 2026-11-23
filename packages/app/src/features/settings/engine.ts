/**
 * Browser side of the settings sync, without React or the stores (those are
 * plugged in by sync.tsx, tests plug in plain objects).
 *
 * - The stores stay the working copy (localStorage), so the app works offline.
 * - Local changes become operations (`diffOps`) in an outbox kept in
 *   localStorage and sent in batches; failures are retried.
 * - A fresh server copy is applied to the stores with the outbox on top, so
 *   unsent changes are not lost.
 * - First load after the move to the server: what this browser had is
 *   uploaded once as "merge" operations (never overwrites newer server values;
 *   lists are unioned, roll counts added). The browser copy is not cleared;
 *   the upload is marked done only after the server accepted it.
 * - Changes the server refuses (role) stay in this browser ("local only").
 */
import { applyOps, diffOps, migrationOps, queueOp, type ScopeKind, type ScopedOp, type SettingEntry } from "./model";

export interface SettingsSnapshot {
  shared: SettingEntry[];
  user: SettingEntry[] | null;
  /** "user:<id>" when signed in. */
  userScope: string | null;
}

export interface PatchResult {
  changed: { scope: ScopeKind; entry: SettingEntry | { key: string; deleted: true } }[];
  denied: { scope: ScopeKind; key: string; status: number; error: string }[];
}

export type Queued = ScopedOp & { mig?: boolean };

export interface SyncMeta {
  sharedMigrated: boolean;
  /** User scopes whose browser data was uploaded. */
  userMigrated: string[];
  /** Whose per-user settings the browser copy holds (null: anonymous / from before the move). */
  userOwner: string | null;
  /** Values the server refused (role), kept in this browser. */
  localOnly: { shared: Record<string, unknown>; user: Record<string, unknown> };
}

export interface SyncAdapters {
  readShared: () => Record<string, unknown>;
  writeShared: (m: Record<string, unknown>) => void;
  readUser: () => Record<string, unknown>;
  writeUser: (m: Record<string, unknown>) => void;
  load: (name: "outbox" | "meta") => unknown;
  save: (name: "outbox" | "meta", v: unknown) => void;
  send: (ops: ScopedOp[]) => Promise<PatchResult>;
  /** The server refused some changes (shown once per batch). */
  onDenied?: (d: PatchResult["denied"]) => void;
}

const freshMeta = (): SyncMeta => ({ sharedMigrated: false, userMigrated: [], userOwner: null, localOnly: { shared: {}, user: {} } });
const toMap = (entries: SettingEntry[]) => Object.fromEntries(entries.map((e) => [e.key, e.value]));
const strip = ({ mig: _m, ...op }: Queued): ScopedOp => (void _m, op as ScopedOp);

export class SettingsSyncEngine {
  outbox: Queued[];
  meta: SyncMeta;
  /** Last state known to be in step with server + outbox, per scope (null: not synced). */
  private base: { shared: Record<string, unknown> | null; user: Record<string, unknown> | null };
  /** Per-user settings go to the server (signed in); unknown until the first snapshot. */
  userSynced: boolean | null = null;
  /** A snapshot was applied: the outbox may be sent. */
  ready = false;
  private applying = false;
  private sending: Promise<void> | null = null;

  constructor(private a: SyncAdapters) {
    const ob = a.load("outbox");
    this.outbox = Array.isArray(ob) ? (ob as Queued[]) : [];
    const m = a.load("meta") as Partial<SyncMeta> | null;
    this.meta = { ...freshMeta(), ...(m ?? {}), localOnly: { shared: {}, user: {}, ...(m?.localOnly ?? {}) } };
    // Changes made before the first server answer are queued against the browser copy.
    this.base = { shared: a.readShared(), user: a.readUser() };
  }

  private persist() {
    this.a.save("outbox", this.outbox);
    this.a.save("meta", this.meta);
  }

  private push(op: Queued) {
    this.outbox = queueOp(this.outbox, op);
  }

  /** Call after any store change. Turns the difference into queued operations. */
  localChanged() {
    if (this.applying) return;
    let any = false;
    for (const scope of ["shared", "user"] as const) {
      const base = this.base[scope];
      if (!base || (scope === "user" && this.userSynced === false)) continue;
      const next = scope === "shared" ? this.a.readShared() : this.a.readUser();
      const ops = diffOps(scope, base, next);
      this.base[scope] = next;
      for (const op of ops) {
        this.push({ ...op, scope });
        any = true;
      }
    }
    if (any) this.persist();
    return any;
  }

  private write(scope: ScopeKind, view: Record<string, unknown>) {
    this.applying = true;
    try {
      if (scope === "shared") this.a.writeShared(view);
      else this.a.writeUser(view);
    } finally {
      this.applying = false;
    }
    this.base[scope] = scope === "shared" ? this.a.readShared() : this.a.readUser();
  }

  private view(scope: ScopeKind, server: Record<string, unknown>) {
    const withLocal = { ...this.meta.localOnly[scope], ...server };
    return applyOps(
      scope,
      withLocal,
      this.outbox.filter((o) => o.scope === scope),
    );
  }

  private queueMigration(scope: ScopeKind, local: Record<string, unknown>) {
    if (this.outbox.some((o) => o.scope === scope && o.mig)) return;
    const ops = migrationOps(local);
    for (const op of ops) this.outbox.push({ ...op, scope, mig: true });
    // Nothing to upload: done now. (Left pending, a later load would "upload" the server's own
    // copy back and double the roll counts.)
    if (!ops.length) this.markMigrated(scope);
  }

  private markMigrated(scope: ScopeKind) {
    if (scope === "shared") this.meta.sharedMigrated = true;
    else if (this.meta.userOwner && !this.meta.userMigrated.includes(this.meta.userOwner)) this.meta.userMigrated.push(this.meta.userOwner);
  }

  /** Apply a server copy (first load and every refresh). */
  applySnapshot(s: SettingsSnapshot) {
    this.localChanged();
    if (!this.meta.sharedMigrated) this.queueMigration("shared", this.a.readShared());
    this.write("shared", this.view("shared", toMap(s.shared)));

    if (!s.user || !s.userScope) {
      this.userSynced = false;
      this.outbox = this.outbox.filter((o) => o.scope !== "user");
      // Signed out: don't leave the last person's favourites in this browser.
      if (this.meta.userOwner) {
        this.meta.userOwner = null;
        this.meta.localOnly.user = {};
        this.write("user", {});
      }
    } else {
      const scope = s.userScope;
      if (this.meta.userOwner !== scope) {
        // Anonymous / pre-server favourites go to whoever signs in here (lists are unioned, so
        // repeating it is harmless); another person's copy is just replaced.
        const anonymous = this.meta.userOwner === null;
        this.meta.userOwner = scope;
        this.meta.localOnly.user = {};
        if (anonymous) this.queueMigration("user", this.a.readUser());
        else this.outbox = this.outbox.filter((o) => o.scope !== "user");
      } else if (!this.meta.userMigrated.includes(scope)) this.queueMigration("user", this.a.readUser());
      this.userSynced = true;
      if (!this.base.user) this.base.user = this.a.readUser();
      this.write("user", this.view("user", toMap(s.user)));
    }
    this.ready = true;
    this.persist();
  }

  /** Send queued operations (one batch at a time). Resolves false when it should be retried. */
  async flush(): Promise<boolean> {
    if (!this.ready) return false;
    if (this.sending) {
      await this.sending;
      return this.flush();
    }
    if (!this.outbox.length) return true;
    const batch = this.outbox.slice(0, 500);
    let result: PatchResult;
    let done!: () => void;
    this.sending = new Promise((r) => (done = r));
    try {
      result = await this.a.send(batch.map(strip));
    } catch {
      return false;
    } finally {
      this.sending = null;
      done();
    }
    this.outbox = this.outbox.filter((o) => !batch.includes(o));
    const refused = new Map(result.denied.map((d) => [`${d.scope}\n${d.key}`, d.status]));
    for (const op of batch) {
      const status = refused.get(`${op.scope}\n${op.key}`);
      const lo = this.meta.localOnly[op.scope];
      // Not allowed to change it for everyone: keep this browser's value (invalid ones are dropped).
      if ((status === 403 || status === 401) && (op.op === "set" || op.op === "merge")) lo[op.key] = op.value;
      else delete lo[op.key];
    }
    for (const scope of ["shared", "user"] as const) {
      if (batch.some((o) => o.scope === scope && o.mig) && !this.outbox.some((o) => o.scope === scope && o.mig)) this.markMigrated(scope);
    }
    this.applyChanged(result.changed);
    this.persist();
    if (result.denied.length) this.a.onDenied?.(result.denied);
    return this.outbox.length ? this.flush() : true;
  }

  /** Server results of a batch (e.g. merged roll counts) into the stores, unless changed again since. */
  private applyChanged(changed: PatchResult["changed"]) {
    for (const scope of ["shared", "user"] as const) {
      const base = this.base[scope];
      if (!base || (scope === "user" && !this.userSynced)) continue;
      const mine = changed.filter((c) => c.scope === scope && !this.outbox.some((o) => o.scope === scope && o.key === c.entry.key));
      if (!mine.length) continue;
      this.localChanged();
      const next = { ...(scope === "shared" ? this.a.readShared() : this.a.readUser()) };
      for (const c of mine) {
        if ("deleted" in c.entry) {
          if (!(c.entry.key in this.meta.localOnly[scope])) delete next[c.entry.key];
        } else next[c.entry.key] = c.entry.value;
      }
      this.write(scope, next);
    }
  }
}

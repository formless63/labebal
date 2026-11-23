/**
 * Label pages (`/l/<id>`): the record a label's QR code opens. Pure helpers
 * shared by the server (server/label-page.ts) and the page; no DB or DOM.
 */
import { labelIdForRow, type DataRow, type DatasetLink, type Label, type Template } from "@labebal/core";

/** Everything the label page shows (GET /api/labels/<id>). */
export interface LabelPageData {
  label: Label;
  template: Template;
  /** Folder path from the label's `folder:` tag ("" = none). */
  folder: string;
  /** Template fields (in template order), then any other values, as display rows. */
  fields: FieldRow[];
  /** Absolute URL of this page (LABEBAL_PUBLIC_URL, else the request origin). */
  url: string;
  /** The template's `recordUrl` filled with this label's values, when set and absolute. */
  recordUrl?: string;
  /** The dataset row the label was made from, when it still exists. */
  source?: { datasetId: string; datasetName: string; rowId: string; cells: { name: string; value: string; href?: string }[] };
  notes: { text: string; updatedBy: string; updatedAt: string } | null;
  /** Newest prints of this label (voided ones excluded), newest first. */
  prints: { historyId: string; printedAt: string; who: string; printer: string; sizeName: string; qty: number }[];
}

export interface FieldRow {
  key: string;
  label: string;
  value: string;
  /** Set when the value is a web / mail link (tappable). */
  href?: string;
}

/** A tappable link for a value: http(s) URLs, `www.` hosts and plain e-mail addresses. */
export function linkFor(value: string): string | undefined {
  const v = value.trim();
  if (!v || /\s/.test(v)) return undefined;
  if (/^https?:\/\/[^/\s]+/i.test(v)) {
    try {
      return new URL(v).href;
    } catch {
      return undefined;
    }
  }
  if (/^www\.[^/\s]+\.[a-z]{2,}/i.test(v)) return `https://${v}`;
  if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v)) return `mailto:${v}`;
  return undefined;
}

/** True for an absolute http(s) URL (record links must not be `javascript:` and the like). */
export const isHttpUrl = (s: string | undefined): s is string => !!s && /^https?:\/\/[^/\s]+/i.test(s.trim());

/** An absolute http(s) URL, percent-encoded where needed (spaces, Ω...); undefined when it is not one. */
export function normalizedHttpUrl(s: string | undefined): string | undefined {
  if (!isHttpUrl(s)) return undefined;
  try {
    return new URL(s.trim()).href;
  } catch {
    return undefined;
  }
}

/**
 * Display rows for a label: template fields in order (template label, the
 * label's value or the field default), then values with no field. Empty
 * values are kept for fields (shown as "—") but dropped for extras.
 */
export function fieldRows(t: Pick<Template, "fields">, values: Record<string, string>): FieldRow[] {
  const row = (key: string, label: string, value: string): FieldRow => {
    const href = linkFor(value);
    return href ? { key, label, value, href } : { key, label, value };
  };
  const known = new Set(t.fields.map((f) => f.key));
  return [
    ...t.fields.map((f) => row(f.key, f.label || f.key, values[f.key] ?? f.default ?? "")),
    ...Object.entries(values)
      .filter(([k, v]) => !known.has(k) && v.trim())
      .map(([k, v]) => row(k, k, v)),
  ];
}

/** Dataset id from a label's `dataset:<id>` tag (labels made from rows carry one). */
export const datasetOfLabel = (l: Pick<Label, "tags">) => l.tags?.find((t) => t.startsWith("dataset:"))?.slice("dataset:".length) || undefined;

/** The row whose label id (see `labelIdForRow`) is this label's id. */
export function rowForLabel(link: DatasetLink, labelId: string, rows: DataRow[]): DataRow | undefined {
  if (!labelId.startsWith(link.idPrefix)) return undefined;
  return rows.find((r) => labelIdForRow(link, r) === labelId);
}

/**
 * The origin a request came in on, as the browser saw it: the reverse proxy's
 * `x-forwarded-proto` / `x-forwarded-host` (first value), else `host`, else `fallback`.
 */
export function requestOrigin(header: (name: string) => string | null, fallback: string): string {
  const first = (v: string | null) => v?.split(",")[0]?.trim() || undefined;
  const host = first(header("x-forwarded-host")) ?? first(header("host"));
  if (!host || !/^[\w.-]+(:\d+)?$|^\[[0-9a-f:]+\](:\d+)?$/i.test(host)) return fallback;
  const proto = first(header("x-forwarded-proto")) ?? new URL(fallback).protocol.replace(":", "");
  return `${proto === "https" ? "https" : "http"}://${host}`;
}

/**
 * Base URL for label pages: `LABEBAL_PUBLIC_URL` when set (trailing slashes
 * dropped), else the origin the request came in on.
 */
export function publicBaseUrl(env: string | undefined, requestOrigin: string): string {
  const e = env?.trim().replace(/\/+$/, "");
  return e && isHttpUrl(e) ? e : requestOrigin.replace(/\/+$/, "");
}

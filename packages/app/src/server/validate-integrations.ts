/** Zod schemas for data sources, the print inbox and webhooks. */
import { z } from "zod";

const id = z.string().min(1).max(200);
const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((u) => /^https?:\/\//i.test(u), { message: "must be an http(s) URL" });

/** Header names a source may set (no hop-by-hop / framing headers). */
const FORBIDDEN_HEADERS = new Set(["host", "content-length", "transfer-encoding", "connection", "upgrade", "te", "trailer", "keep-alive", "proxy-authorization", "cookie2"]);
const headerName = z
  .string()
  .trim()
  .max(100)
  .regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]*$/, "not a valid header name")
  .refine((h) => !FORBIDDEN_HEADERS.has(h.toLowerCase()), { message: "this header can't be set" });

export const sourceSchema = z.object({
  kind: z.enum(["csv", "json"]),
  url: httpUrl,
  headerName: headerName.nullable().optional(),
  headerValue: z.string().max(4000).regex(/^[^\r\n]*$/, "no line breaks").nullable().optional(),
  rowsPath: z.string().max(500).nullable().optional(),
  fields: z
    .array(z.object({ column: z.string().trim().max(200), path: z.string().trim().max(500) }))
    .max(200)
    .optional(),
  keyColumn: z.string().max(200).nullable().optional(),
  mode: z.enum(["upsert", "replace"]).optional(),
  applyLabels: z.boolean().optional(),
  intervalMinutes: z.number().int().min(0).max(60 * 24 * 7).nullable().optional(),
});

const value = z.union([z.string().max(10_000), z.number(), z.boolean()]).transform(String);

/** POST /api/v1/print-requests */
export const printRequestSchema = z
  .object({
    labelId: id.optional(),
    templateId: id.optional(),
    /** Record key: with templateId names the label `l-<template>-<key>` (created on approval if values are given). */
    key: z.string().min(1).max(200).optional(),
    name: z.string().min(1).max(500).optional(),
    values: z.record(z.string().max(200), value).optional(),
    qty: z.number().int().min(1).max(999).default(1),
    note: z.string().max(2000).default(""),
    requestedBy: z.string().trim().max(200).default(""),
  })
  .refine((r) => r.labelId || r.templateId, { message: "give labelId, or templateId (+ key and/or values)" });

export const approveSchema = z.object({ qty: z.number().int().min(1).max(999).optional(), who: z.string().trim().max(100).optional() });
export const rejectSchema = z.object({ reason: z.string().trim().max(1000).optional(), who: z.string().trim().max(100).optional() });

const events = z.array(z.string().max(50)).max(20);

export const webhookCreateSchema = z.object({ name: z.string().trim().max(100).default(""), url: httpUrl, events: events.default([]) });
export const webhookPatchSchema = z.object({
  name: z.string().trim().max(100).optional(),
  url: httpUrl.optional(),
  events: events.optional(),
  enabled: z.boolean().optional(),
  rotateSecret: z.boolean().optional(),
});

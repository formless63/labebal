import { z } from "zod";
import { PackError } from "@labebal/core";
import { FetchError } from "./safe-fetch";

export const addSourceSchema = z.object({
  input: z.string().trim().min(1).max(2000),
  token: z.string().trim().max(500).nullish(),
  /** Read a GitHub source with one of your connected accounts. */
  accountId: z.string().min(1).max(100).nullish(),
});

export const patchSourceSchema = z.object({
  token: z.string().trim().max(500).nullish(),
  accountId: z.string().min(1).max(100).nullish(),
  name: z.string().trim().max(200).optional(),
});

export const installSchema = z.object({
  sourceId: z.string().min(1).max(200),
  packId: z.string().min(1).max(64),
  /** Only these labels (all templates); omitted / null = everything. */
  labelIds: z.array(z.string().min(1).max(200)).max(10_000).nullish(),
});

export const patchPackSchema = z.object({ enabled: z.boolean() });

const kind = z.enum(["template", "label", "dataset", "asset"]);
export const resetSchema = z.object({
  packId: z.string().min(1).max(64).optional(),
  items: z.array(z.object({ kind, id: z.string().min(1).max(200) })).max(10_000).optional(),
});

export const exportSchema = z.object({
  manifest: z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/, "id: lowercase letters, digits, . _ - (max 64)"),
    name: z.string().trim().min(1).max(200),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "version: semver, e.g. 1.0.0"),
    description: z.string().max(2000).optional(),
    author: z.string().max(200).optional(),
    homepage: z.string().max(500).optional(),
    folder: z.string().max(200).optional(),
  }),
  templateIds: z.array(z.string().min(1).max(200)).max(5000).default([]),
  labelIds: z.array(z.string().min(1).max(200)).max(20_000).default([]),
  /** Also include datasets linked to the exported templates. */
  datasets: z.boolean().default(false),
});

/** Pack / fetch problems are the caller's to fix: 400 with the message; anything else rethrows. */
export async function packErrors(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof PackError || e instanceof FetchError) return Response.json({ error: e.message, ...(e instanceof PackError && e.issues.length ? { issues: e.issues } : {}) }, { status: 400 });
    throw e;
  }
}

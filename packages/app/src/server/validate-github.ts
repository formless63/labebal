import { z } from "zod";
import { PackError } from "@labebal/core";
import type { Identity } from "../features/auth/identity";
import { GH_NAME } from "../features/github/model";
import { GithubError, ownScope } from "./github";
import { getIdentity } from "./identity";
import { FetchError } from "./safe-fetch";

const ghName = z.string().regex(GH_NAME, "letters, digits, . _ - (max 100)");

export const tokenAccountSchema = z.object({
  token: z.string().trim().min(1).max(300),
  /** Check access to this repo too ("owner/repo"). */
  repo: z.string().trim().max(201).nullish(),
});

export const patchAccountSchema = z.object({
  commitEmail: z.string().trim().max(200).email().or(z.literal("")).nullish(),
  defaultRepo: z.string().trim().max(201).nullish(),
});

export const createRepoSchema = z.object({
  name: ghName,
  private: z.boolean().default(true),
  description: z.string().trim().max(350).default("Label packs for labebal"),
});

const packId = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/, "id: lowercase letters, digits, . _ - (max 64)");

export const publishSchema = z.object({
  accountId: z.string().min(1).max(100),
  owner: ghName,
  repo: ghName,
  branch: z.string().trim().max(200).regex(/^[\w./-]*$/).optional(),
  dir: z.string().trim().max(300).default(""),
  manifest: z.object({
    id: packId,
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2000).optional(),
    author: z.string().max(200).optional(),
    homepage: z.string().max(500).optional(),
    folder: z.string().max(200).optional(),
  }),
  bump: z.enum(["patch", "minor", "major"]).default("patch"),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "version: semver, e.g. 1.0.0")
    .optional(),
  templateIds: z.array(z.string().min(1).max(200)).max(5000).default([]),
  labelIds: z.array(z.string().min(1).max(200)).max(20_000).default([]),
  datasets: z.boolean().default(false),
});

export const skipSchema = z.object({ version: z.string().min(1).max(100).nullable() });

export const checkUpdatesSchema = z.object({ force: z.boolean().optional() });

/** The caller's account scope, or a 401 response. */
export function scopeOr401(req: Request): { scope: string; me: Identity } | Response {
  const me = getIdentity(req);
  const scope = ownScope(me);
  if (!scope) return Response.json({ error: "Sign in to connect GitHub accounts." }, { status: 401 });
  return { scope, me };
}

/** GitHub / pack problems become JSON errors with their status; anything else rethrows. Tokens never appear in messages. */
export async function githubErrors(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof GithubError) return Response.json({ error: e.message, ...(e.status === 401 ? { reconnect: true } : {}) }, { status: e.status >= 500 ? 502 : e.status });
    if (e instanceof PackError || e instanceof FetchError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

export const noStore = { "cache-control": "private, no-store" };

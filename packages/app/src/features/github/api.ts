"use client";
/** GitHub: TanStack Query hooks over /api/github (server/github*.ts). Tokens never reach the browser. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { json, send } from "../data/api";
import { useCan } from "../auth/me-client";
import type { DeviceStartView, DeviceStatusView, GithubAccountView, GithubConfigView, GithubRepoView, PublishedPackView, PublishResult, Bump } from "./model";
import { apiRoot } from "../../lib/base";

export const GITHUB_KEY = ["github"] as const;
export const PUBLISHED_KEY = ["github", "published"] as const;

export function useGithub() {
  return useQuery({
    queryKey: GITHUB_KEY,
    queryFn: () => fetch(`${apiRoot()}/github`).then((r) => json<{ config: GithubConfigView; accounts: GithubAccountView[] }>(r)),
    staleTime: 60_000,
  });
}

export function usePublished() {
  const editor = useCan("editor");
  return useQuery({ queryKey: PUBLISHED_KEY, queryFn: () => fetch(`${apiRoot()}/github/published`).then((r) => json<PublishedPackView[]>(r)), enabled: editor });
}

export function useRepos(accountId: string | null) {
  return useQuery({
    queryKey: ["github", "repos", accountId],
    queryFn: () => fetch(`${apiRoot()}/github/accounts/${encodeURIComponent(accountId!)}/repos`).then((r) => json<{ repos: GithubRepoView[]; installations: number; installUrl: string | null }>(r)),
    enabled: !!accountId,
    staleTime: 30_000,
    retry: false,
  });
}

export interface RepoPacks {
  packs: { dir: string; id: string; name: string; version: string; description: string }[];
  defaultBranch: string;
  canWrite: boolean;
}

export function useRepoPacks(accountId: string | null, repo: string | null) {
  return useQuery({
    queryKey: ["github", "repo-packs", accountId, repo],
    queryFn: () => fetch(`${apiRoot()}/github/accounts/${encodeURIComponent(accountId!)}/repos/${repo!.split("/").map(encodeURIComponent).join("/")}`).then((r) => json<RepoPacks>(r)),
    enabled: !!accountId && !!repo,
    retry: false,
  });
}

export interface PublishInput {
  accountId: string;
  owner: string;
  repo: string;
  dir: string;
  manifest: { id: string; name: string; description?: string; author?: string; folder?: string };
  bump: Bump;
  templateIds: string[];
  labelIds: string[];
  datasets: boolean;
}

export function useGithubActions() {
  const qc = useQueryClient();
  const after = () => qc.invalidateQueries({ queryKey: GITHUB_KEY });
  const acc = (id: string) => `${apiRoot()}/github/accounts/${encodeURIComponent(id)}`;
  return {
    startDevice: () => send(`${apiRoot()}/github/device`, "POST").then((r) => json<DeviceStartView>(r)),
    deviceStatus: (id: string) => fetch(`${apiRoot()}/github/device/${encodeURIComponent(id)}`).then((r) => json<DeviceStatusView>(r)),
    cancelDevice: (id: string) => send(`${apiRoot()}/github/device/${encodeURIComponent(id)}`, "DELETE"),
    addToken: async (token: string, repo?: string) => {
      const r = await send(`${apiRoot()}/github/accounts`, "POST", { token, repo: repo || null }).then((x) => json<{ account: GithubAccountView; repo?: GithubRepoView }>(x));
      await after();
      return r;
    },
    patchAccount: async (id: string, p: { commitEmail?: string | null; defaultRepo?: string | null }) => {
      const r = await send(acc(id), "PATCH", p).then((x) => json<GithubAccountView>(x));
      await after();
      return r;
    },
    removeAccount: async (id: string) => {
      await send(acc(id), "DELETE").then((x) => json<void>(x));
      await after();
    },
    createRepo: async (id: string, p: { name: string; private: boolean; description: string }) => {
      const r = await send(`${acc(id)}/repos`, "POST", p).then((x) => json<{ created: boolean; repo?: GithubRepoView; needsInstall?: boolean; installUrl?: string | null; newRepoUrl?: string; reason?: string }>(x));
      await qc.invalidateQueries({ queryKey: ["github", "repos", id] });
      return r;
    },
    publish: async (p: PublishInput) => {
      const r = await send(`${apiRoot()}/github/publish`, "POST", p).then((x) => json<PublishResult>(x));
      await Promise.all([qc.invalidateQueries({ queryKey: PUBLISHED_KEY }), after(), qc.invalidateQueries({ queryKey: ["github", "repo-packs"] })]);
      return r;
    },
    unpublish: async (id: string, accountId?: string) => {
      const r = await send(`${apiRoot()}/github/published/${encodeURIComponent(id)}${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ""}`, "DELETE").then((x) => json<{ removed: number; commitUrl: string }>(x));
      await qc.invalidateQueries({ queryKey: PUBLISHED_KEY });
      return r;
    },
  };
}

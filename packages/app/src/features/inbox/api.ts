"use client";
/** Print inbox data access: requests from other systems waiting for approval in a browser. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { json, send } from "../data/api";
import { getWho } from "../history/who";
import { LIBRARY_KEY } from "../labels/api";
import { useLabelStore } from "../labels/store";
import { apiRoot } from "../../lib/base";

export interface PrintRequest {
  id: string;
  status: "pending" | "approved" | "rejected";
  labelId: string | null;
  templateId: string | null;
  key: string | null;
  name: string | null;
  values: Record<string, string> | null;
  qty: number;
  note: string;
  requestedBy: string;
  tokenName: string;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string;
  reason: string;
  labelName?: string;
  templateName?: string;
}

export const INBOX_KEY = ["inbox"] as const;
const COUNT_KEY = ["inbox", "count"] as const;

/** Pending requests; polled so new ones appear without a reload. */
export function useInboxCount() {
  return useQuery({
    queryKey: COUNT_KEY,
    queryFn: () => fetch(`${apiRoot()}/inbox/count`).then((r) => json<{ pending: number }>(r)),
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
  });
}

export function useInbox(status?: PrintRequest["status"]) {
  return useQuery({
    queryKey: [...INBOX_KEY, status ?? "all"],
    queryFn: () => fetch(`${apiRoot()}/inbox?limit=200${status ? `&status=${status}` : ""}`).then((r) => json<PrintRequest[]>(r)),
    refetchInterval: 20_000,
  });
}

export function useInboxActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: INBOX_KEY });

  /** Approve -> the label (created if needed) goes into this browser's print queue. */
  const approve = useMutation({
    mutationFn: ({ id, qty }: { id: string; qty?: number }) =>
      send(`${apiRoot()}/inbox/${encodeURIComponent(id)}/approve`, "POST", { qty, who: getWho() || undefined }).then((r) => json<{ request: PrintRequest; labelId: string; qty: number }>(r)),
    onSuccess: async (r) => {
      // The label may be new: reload the library before queueing so the queue can show it.
      await qc.invalidateQueries({ queryKey: LIBRARY_KEY });
      useLabelStore.getState().enqueue(r.labelId, r.qty);
    },
    onSettled: () => void refresh(),
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      send(`${apiRoot()}/inbox/${encodeURIComponent(id)}/reject`, "POST", { reason, who: getWho() || undefined }).then((r) => json<PrintRequest>(r)),
    onSettled: () => void refresh(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => send(`${apiRoot()}/inbox/${encodeURIComponent(id)}`, "DELETE").then((r) => json<void>(r)),
    onSettled: () => void refresh(),
  });

  return { approve, reject, remove };
}

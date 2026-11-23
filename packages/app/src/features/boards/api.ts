"use client";
/** Quick print boards data access (TanStack Query). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { json } from "../data/api";
import { apiRoot } from "../../lib/base";

export interface BoardTile {
  labelId: string;
  sizeId: string;
  qty: number;
}

export interface Board {
  id: string;
  name: string;
  notes: string;
  tiles: BoardTile[];
  updatedAt?: string;
}

export const BOARDS_KEY = ["boards"] as const;

export const newBoardId = () => `board-${crypto.randomUUID().slice(0, 8)}`;

export function useBoards() {
  return useQuery({ queryKey: BOARDS_KEY, queryFn: () => fetch(`${apiRoot()}/boards`).then((r) => json<Board[]>(r)) });
}

export function useBoardActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: BOARDS_KEY });
  const save = useMutation({
    mutationFn: (b: Board) =>
      fetch(`${apiRoot()}/boards/${encodeURIComponent(b.id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((x) => json<Board>(x)),
    onSuccess: refresh,
  });
  const create = useMutation({
    mutationFn: (b: Board) => fetch(`${apiRoot()}/boards`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((x) => json<Board>(x)),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => fetch(`${apiRoot()}/boards/${encodeURIComponent(id)}`, { method: "DELETE" }).then((x) => json<void>(x)),
    onSuccess: refresh,
  });
  return { save, create, remove };
}

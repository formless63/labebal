"use client";
/**
 * "Who": a display name per browser (localStorage), recorded with each print
 * until labebal has user accounts (an embedding host can use its signed-in user).
 */
import { useSyncExternalStore } from "react";

const KEY = "labebal.who";
const listeners = new Set<() => void>();

export function getWho(): string {
  try {
    return (typeof localStorage === "undefined" ? "" : localStorage.getItem(KEY)) ?? "";
  } catch {
    return "";
  }
}

export function setWho(name: string) {
  try {
    const v = name.trim().slice(0, 100);
    if (v) localStorage.setItem(KEY, v);
    else localStorage.removeItem(KEY);
  } catch {}
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => e.key === KEY && l();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
};

/** The name set in this browser ("" when none). */
export const useWho = () => useSyncExternalStore(subscribe, getWho, () => "");

"use client";
import { useFontAssets } from "./fonts-client";

/**
 * Registers uploaded fonts (and the icon source) at app start so the renderer
 * and the editor's font pickers see them. Renders its children unchanged.
 */
export function FontsProvider({ children }: { children: React.ReactNode }) {
  useFontAssets();
  return children;
}

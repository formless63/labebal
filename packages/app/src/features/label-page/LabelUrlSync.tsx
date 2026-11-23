"use client";
/**
 * Points `{{labelUrl}}` at the configured public URL (LABEBAL_PUBLIC_URL, from
 * /api/config). Until it loads, or when it is not set, core uses the page origin.
 */
import { useEffect } from "react";
import { setLabelUrlBase } from "@labebal/core";
import { apiRoot } from "../../lib/base";

export function LabelUrlSync() {
  useEffect(() => {
    let live = true;
    fetch(`${apiRoot()}/config`)
      .then((r) => (r.ok ? (r.json() as Promise<{ publicUrl?: string | null }>) : null))
      .then((c) => {
        if (live && c?.publicUrl) setLabelUrlBase(c.publicUrl);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return null;
}

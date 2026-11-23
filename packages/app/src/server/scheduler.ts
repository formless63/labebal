/**
 * In-process background work for scheduled data-source syncs and webhook
 * retries. One timer per server process (started from `instrumentation.ts`,
 * and lazily by the inbox / sources routes as a fallback). Limits: it only
 * runs while the Node server runs (not on serverless), and with several
 * server instances against one Postgres each instance would sync too.
 */

import { env, host } from "./host";

const TICK_MS = 30_000;

const g = globalThis as unknown as { __labebalScheduler?: ReturnType<typeof setInterval> };

/** One round of background work. Hosts with their own job runner (jobs: "host") call this every ~30 s. */
export async function runJobs() {
  const [{ syncDueSources }, { processDueDeliveries }] = await Promise.all([import("./sources"), import("./webhooks")]);
  await processDueDeliveries().catch((e) => console.error("webhook retries", e));
  await syncDueSources().catch((e) => console.error("scheduled syncs", e));
}

let running = false;

export function ensureScheduler() {
  if (g.__labebalScheduler || host().jobs === "host" || env().LABEBAL_SCHEDULER === "off") return;
  g.__labebalScheduler = setInterval(() => {
    if (running) return;
    running = true;
    void runJobs().finally(() => (running = false));
  }, TICK_MS);
  g.__labebalScheduler.unref?.();
}

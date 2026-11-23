/** Runs once when the Next.js server starts: the module's timers (data-source syncs, webhook retries, scheduled backups). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { labebal } = await import("./labebal");
  labebal.start();
}

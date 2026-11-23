import { connection } from "next/server";
import { labebal } from "@/labebal";

/** Every /api/* request goes to the module's handler. */
async function handle(req: Request) {
  await connection();
  return labebal.handler(req);
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };

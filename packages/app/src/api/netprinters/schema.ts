import { z } from "zod";

/** Hostname, IPv4 or IPv6 (no scheme, no path). */
export const host = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(
    /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$|^\d{1,3}(?:\.\d{1,3}){3}$|^\[?[0-9a-fA-F:]+\]?$/,
    "Enter a host name or IP address, e.g. 192.168.1.50",
  );
export const port = z.number().int().min(1).max(65535);
export const thermal = z.enum(["direct", "transfer", "both"]);

export const addSchema = z.object({
  name: z.string().trim().min(1).max(100),
  host,
  port: port.default(9100),
  thermal: thermal.optional(),
  /** Set by hand when detection is not possible. */
  dpi: z.number().int().min(100).max(1200).optional(),
  headDots: z.number().int().min(64).max(10000).optional(),
  /** What detection reported, kept for display. */
  model: z.string().max(100).optional(),
});

export const patchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  host: host.optional(),
  port: port.optional(),
  thermal: thermal.optional(),
  dpi: z.number().int().min(100).max(1200).optional(),
  headDots: z.number().int().min(64).max(10000).optional(),
});

export const detectSchema = z.object({ host, port: port.default(9100) });

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

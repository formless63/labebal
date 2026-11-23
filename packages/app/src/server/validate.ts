import { z } from "zod";
import type { Label, LabelComponent, Template, TextStyle } from "@labebal/core";

const id = z.string().min(1).max(200);

/** Light structural validation; the document model itself is versioned by `schema`. */
export const templateSchema = z.looseObject({
  id,
  name: z.string().min(1),
  schema: z.literal(2),
  design: z.object({ w: z.number().positive(), h: z.number().positive() }),
  root: z.looseObject({ id, type: z.literal("frame") }),
  fields: z.array(z.looseObject({ key: z.string(), label: z.string() })),
}) as unknown as z.ZodType<Template>;

export const labelSchema = z.looseObject({
  id,
  templateId: id,
  name: z.string().min(1),
  values: z.record(z.string(), z.string()),
  overrides: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  invert: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
}) as unknown as z.ZodType<Label>;

/** Shared text style (core `TextStyle`): id + name, the rest are text props. */
export const textStyleSchema = z.looseObject({
  id,
  name: z.string().min(1),
  font: z.string().optional(),
  sizePt: z.number().positive().optional(),
}) as unknown as z.ZodType<TextStyle>;

/** Reusable component (core `LabelComponent`). */
export const componentSchema = z.looseObject({
  id,
  name: z.string().min(1),
  design: z.object({ w: z.number().positive(), h: z.number().positive() }),
  root: z.looseObject({ id, type: z.literal("frame"), children: z.array(z.unknown()) }),
}) as unknown as z.ZodType<LabelComponent>;

export const librarySchema = z.object({
  templates: z.array(templateSchema).default([]),
  labels: z.array(labelSchema).default([]),
  styles: z.array(textStyleSchema).optional(),
  components: z.array(componentSchema).optional(),
});

export async function parseBody<T>(req: Request, schema: z.ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; res: Response }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, res: Response.json({ error: "invalid JSON" }, { status: 400 }) };
  }
  const r = schema.safeParse(body);
  if (!r.success) return { ok: false, res: Response.json({ error: "invalid body", issues: r.error.issues }, { status: 400 }) };
  return { ok: true, data: r.data };
}

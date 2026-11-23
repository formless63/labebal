/** Writes docs/public/openapi.json: the public /api/v1 endpoints, request bodies taken from the server's own zod schemas. */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "../../packages/app/node_modules/zod/index.js";
import { reserveSchema } from "../../packages/app/src/server/counters";
import { v1LabelsSchema, v1RowsSchema } from "../../packages/app/src/server/validate-data";
import { printRequestSchema } from "../../packages/app/src/server/validate-integrations";

const body = (schema: unknown, examples: Record<string, unknown>) => {
  const s = z.toJSONSchema(schema as never, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete s.$schema;
  return {
    required: true,
    content: { "application/json": { schema: s, examples: Object.fromEntries(Object.entries(examples).map(([k, value]) => [k, { value }])) } },
  };
};
const str = { type: "string" };
const int = { type: "integer" };
const nullable = { type: ["string", "null"] };
const arr = (items: unknown) => ({ type: "array", items });
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties });
const ref = (n: string) => ({ $ref: `#/components/schemas/${n}` });
const json = (description: string, schema: unknown) => ({ description, content: { "application/json": { schema } } });
const errors = { "400": json("Invalid request", ref("Error")), "401": json("Missing, invalid or revoked token", ref("Error")) };
const notFound = { "404": json("Not found", ref("Error")) };
const q = (name: string, description: string, schema: unknown = str) => ({ name, in: "query", description, schema });
const path = (name: string, description: string) => ({ name, in: "path", required: true, description, schema: str });

const doc = {
  openapi: "3.1.0",
  info: {
    title: "labebal REST API",
    version: "1",
    description: "For other systems: push labels and data, reserve numbers, ask for prints. Create a token in Settings > API access.",
    license: { name: "MIT", identifier: "MIT" },
  },
  servers: [{ url: "https://labels.example.com/api/v1", description: "Where your labebal runs (plus its base path when embedded)" }],
  security: [{ token: [] }],
  tags: [{ name: "Templates" }, { name: "Labels" }, { name: "Datasets" }, { name: "Counters" }, { name: "Print requests" }],
  paths: {
    "/templates": {
      get: { tags: ["Templates"], operationId: "listTemplates", summary: "List templates", description: "Every template and the fields its labels can fill.", responses: { "200": json("Templates", arr(ref("Template"))), "401": errors["401"] } },
    },
    "/labels": {
      post: {
        tags: ["Labels"],
        operationId: "upsertLabels",
        summary: "Create or update labels",
        description: "Identify each label by `id`, or by `templateId` + `key` (your record key): sending the same key again updates the same label. `merge` keeps existing values you don't send.",
        requestBody: body(v1LabelsSchema, {
          one: { templateId: "t-drawer-bin", key: "SCR-M5-20", name: "M5 x 20", values: { title: "M5 × 20 socket head", spec: "DIN 912" } },
          several: { merge: true, labels: [{ templateId: "t-drawer-bin", key: "SCR-M5-20", values: { spec: "DIN 912 · A4" } }, { id: "l-muncher-snacks", templateId: "t-muncher", values: { title: "SNACKS" } }] },
        }),
        responses: { "200": json("Saved (400 only when nothing could be saved)", ref("UpsertResult")), ...errors },
      },
    },
    "/datasets/{id}/rows": {
      parameters: [path("id", "Dataset id, shown under its table on the Data page")],
      get: {
        tags: ["Datasets"],
        operationId: "listRows",
        summary: "Read rows",
        parameters: [
          q("q", "Text contained in any cell, case-insensitive"),
          q("column", "Search only this column id"),
          q("sort", "Column id to sort by"),
          q("dir", "Sort direction", { type: "string", enum: ["asc", "desc"] }),
          q("offset", "Rows to skip", int),
          q("limit", "Page size, default 200, max 50,000", int),
          q("ids", "Comma-separated row ids"),
        ],
        responses: { "200": json("A page of rows", ref("RowPage")), "401": errors["401"], ...notFound },
      },
      post: {
        tags: ["Datasets"],
        operationId: "addRows",
        summary: "Add or update rows",
        description: "Rows are objects keyed by column name or id; unknown columns are added. With a key column, matching rows are updated. `applyLabels` also refreshes the dataset's labels.",
        requestBody: body(v1RowsSchema, { rows: { applyLabels: true, rows: [{ SKU: "NUT-M5", Category: "Nuts", Part: "M5 hex nut", Spec: "DIN 934" }] } }),
        responses: { "200": json("What changed", ref("RowsResult")), ...errors, ...notFound },
      },
    },
    "/counters": {
      get: { tags: ["Counters"], operationId: "getCounters", summary: "Read counters", parameters: [q("id", "Only this counter")], responses: { "200": json("All counters, or one with `id`", { oneOf: [arr(ref("Counter")), ref("Counter")] }), "401": errors["401"], ...notFound } },
      post: {
        tags: ["Counters"],
        operationId: "reserve",
        summary: "Reserve numbers",
        description: "Atomic: concurrent calls and browser prints always get separate, gap-free blocks. The counter must exist.",
        requestBody: body(reserveSchema, {
          shared: { counter: "box", n: 5, source: "order 1234" },
          several: { items: [{ counter: "serial", templateId: "t-drawer-bin", values: { sku: "SCR-M3-8" }, n: 2 }] },
        }),
        responses: { "200": json("Reserved blocks, one per item, in order (`from` and `to` inclusive)", obj({ reservations: arr(ref("Reservation")) })), ...errors },
      },
    },
    "/print-requests": {
      get: {
        tags: ["Print requests"],
        operationId: "listPrintRequests",
        summary: "List print requests",
        parameters: [q("status", "Filter", { type: "string", enum: ["pending", "approved", "rejected"] }), q("limit", "Default 50", int)],
        responses: { "200": json("Recent requests", arr(ref("PrintRequest"))), ...errors },
      },
      post: {
        tags: ["Print requests"],
        operationId: "createPrintRequest",
        summary: "Ask for a print",
        description: "Waits in the Inbox until someone at a browser approves it. Nothing prints by itself.",
        requestBody: body(printRequestSchema, {
          label: { labelId: "l-drawer-bin-scr-m3-8", qty: 2, note: "Relabel drawer A3", requestedBy: "inventory" },
          fromValues: { templateId: "t-drawer-bin", key: "NUT-M6", values: { title: "M6 hex nut" }, qty: 1 },
        }),
        responses: { "201": json("Waiting in the Inbox", ref("PrintRequest")), ...errors, "404": json("Unknown label or template", ref("Error")) },
      },
    },
    "/print-requests/{id}": {
      parameters: [path("id", "Print request id")],
      get: { tags: ["Print requests"], operationId: "getPrintRequest", summary: "Status of a print request", responses: { "200": json("The request", ref("PrintRequest")), "401": errors["401"], ...notFound } },
    },
  },
  components: {
    securitySchemes: { token: { type: "http", scheme: "bearer", description: "Token from Settings > API access (`lbl_…`)" } },
    schemas: {
      Error: obj({ error: str, issues: arr({ type: "object" }) }),
      Template: obj({ id: str, name: str, description: str, design: obj({ w: { type: "number", description: "mm" }, h: { type: "number", description: "mm" } }), fields: arr(obj({ key: str, label: str, type: str, default: str })), tags: arr(str), updatedAt: str }),
      UpsertResult: obj({ created: arr(str), updated: arr(str), errors: arr(obj({ index: int, error: str })) }),
      RowPage: obj({ columns: arr(obj({ id: str, name: str })), total: int, offset: int, rows: arr(obj({ id: str, values: { type: "object", additionalProperties: str } })) }),
      RowsResult: obj({ added: int, updated: int, rows: int, labels: obj({ created: int, updated: int, labelIds: arr(str) }) }),
      Counter: obj({ id: str, name: str, scope: { type: "string", enum: ["global", "template", "value"] }, keyField: str, reset: str, start: int, format: str, values: arr(obj({ key: str, next: int, nextNow: int, period: nullable, updatedAt: str })), updatedAt: str }),
      Reservation: obj({ counter: str, key: str, from: int, to: int, format: str }),
      PrintRequest: obj({ id: str, status: { type: "string", enum: ["pending", "approved", "rejected"] }, labelId: nullable, templateId: nullable, key: nullable, qty: int, note: str, requestedBy: str, createdAt: str, decidedAt: nullable, decidedBy: str, reason: str }),
    },
  },
};

const out = fileURLToPath(new URL("../public/openapi.json", import.meta.url));
mkdirSync(fileURLToPath(new URL("../public/", import.meta.url)), { recursive: true });
writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
console.log("wrote openapi.json:", Object.keys(doc.paths).length, "paths");
process.exit(0);

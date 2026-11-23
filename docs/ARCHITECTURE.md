# Architecture

## Layers

| Layer | Path | What |
| --- | --- | --- |
| Label engine | `packages/core` | Framework-free: document schema, reflow layout, 1-bit renderer, fonts, codes, media catalogue, importers, packs, printer drivers. No React, Next or database. |
| App module | `packages/app` (`@labebal/app`) | Every screen (React, shadcn/ui, Tailwind 4, TanStack Query, Zustand) and the API as one fetch-standard handler. Drizzle schema + migrations. |
| Standalone host | `apps/web` | Thin Next.js host of the module: one page, one API route, the PWA parts. The Docker image runs this. |
| Example host | `examples/vite-host` | The module in a Vite + plain Node app. |

Printing stays in the user's browser (Web Bluetooth / Web Serial). The server
stores designs, data and history, and only talks to printers for network (ZPL)
printers.

## Core

| Piece | Path (`packages/core/src`) |
| --- | --- |
| Document model (node tree, frames, sizing, variants, rules) | `schema.ts`, `rules.ts`, `parts.ts` |
| Layout (pure: template + label size -> boxes) | `layout.ts`, `table.ts` |
| Rendering (any 2D canvas, 1-bit output) | `render.ts`, `text.ts`, `material.ts`, `canvas.ts` (swap the canvas with `setCanvasFactory`) |
| Codes (bwip-js underneath, drawn at whole dots) | `codes.ts` |
| Tokens, counters, filters | `tokens.ts`, `counters.ts` |
| Fonts and pixel-font snapping | `fonts.ts`, `fontgrid.ts` |
| Print checks | `preflight.ts` |
| Sizes, materials, RFID roll matching | `media.ts`, `known-rolls.ts` |
| Printers | `printer-base.ts`, `printer.ts` (Niimbot, via niimbluelib), `zpl-print.ts` |
| Packs | `pack.ts`, `share.ts` |
| Importers | `lbx.ts`, `niimblue.ts`, `zpl.ts` |

## App module

| Piece | Path (`packages/app/src`) |
| --- | --- |
| Client entry, host props | `client.tsx` |
| Server entry, host options | `server.ts`, `server/host.ts` |
| Database | `db/schema.ts` (tables are all `label_*`), `db/index.ts`, `../drizzle` |
| API routes | `api/**` -> `api/routes.gen.ts` (run `gen:routes` after adding one) |
| Features | `features/*` (one folder per screen or concern) |
| Built-in fonts, packs | `../assets`, `../packs` |

Identity comes from the host's `user()` callback (or proxy headers in the
container). Roles are viewer, printer, editor and admin.

## Good to know

- Web Bluetooth needs HTTPS (or localhost) and Chrome or Edge. No Firefox or iOS.
- Fonts must be loaded before rendering (`loadFonts`). Pixel fonts need `pxPerEm`
  so they print at whole dots per font pixel.
- Migrations run on first use. In a host's own database they are tracked in
  `drizzle.__labebal_migrations`, apart from the host's.
- Anything that calls `getDb()` must not run inside the start-up seed: the seed
  runs while the database is being opened.
- Render snapshot tests compare a hash of the 1-bit output and write PNGs to
  `packages/core/test/__snapshots__/png`. Review those after `vitest run -u`.

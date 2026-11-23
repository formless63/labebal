# labebal

Design and print labels on Niimbot printers (N1/B18, M2), Brother P-touch (PT-D610BT) and Zebra / ZPL label printers from the browser.
Nothing to install for users: open the page in **Chrome or Edge**, click
**Connect printer**, print. Templates reflow to any label size; the preview is
the exact dot image sent to the printer.

Run it as a container ([docs/DEPLOY.md](docs/DEPLOY.md)), or mount it inside
another React + Postgres app as a module ([docs/EMBEDDING.md](docs/EMBEDDING.md)).
How it fits together: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). What's planned: [docs/ROADMAP.md](docs/ROADMAP.md).

## Layout

| Path | What |
| --- | --- |
| `packages/core` | Framework-free label engine: document schema, reflow layout, 1-bit renderer, fonts, media catalogue, P-touch importer, printer driver (niimbluelib). |
| `packages/app` | The app as a module (`@labebal/app`): every screen (React, shadcn/ui + Tailwind), the API as one fetch handler, database schema + migrations (Drizzle; PGlite embedded or Postgres), built-in fonts, the Examples pack. |
| `apps/web` | The standalone app: a thin Next.js host of the module (what the Docker image runs). |
| `examples/vite-host` | The module inside a non-Next, non-Tailwind app (Vite + plain Node). |
| `docs/` | Deploying, embedding, packs, API, roadmap. |

## Development

```powershell
pnpm install
pnpm dev
```

Open http://localhost:3000 (Web Bluetooth needs `localhost` or HTTPS).

- Data lives in `apps/web/.data/pglite` (embedded Postgres). Delete it to start over (empty library; add packs in Settings > Packs).
  Set `DATABASE_URL` to use a real Postgres instead, or `LABEBAL_DATA_DIR` to move it.
- After changing `packages/app/src/db/schema.ts`: `pnpm --filter @labebal/app db:generate`.
- After adding or removing a file under `packages/app/src/api`: `pnpm --filter @labebal/app gen:routes`.
- Tests: `pnpm test` (core and the module).

Templates and labels are shared as packs (`docs/PACKS.md`): `pnpm packs check <dir>`, `pnpm packs bundle <dir>`, `pnpm packs new <dir>`.
The built-in Examples pack lives in `packages/app/packs/examples`; the Standard formats pack (installed by default, can be turned off) in `packages/app/packs/standards`.

## API

| Method | Path | |
| --- | --- | --- |
| GET | `/api/library` | All templates and labels (also the JSON export). |
| POST | `/api/import` | Merge `{ templates, labels }`; same id replaces. For other systems to push labels. |
| PUT / DELETE | `/api/templates/:id` | Save / delete a template document. |
| PUT / DELETE | `/api/labels/:id` | Save / delete a label. |

Plus datasets, stock runs, history and tokens: see [docs/API.md](docs/API.md).

The browser-facing `/api/*` routes have **no authentication of their own**: run
labebal behind Pangolin (and Pocket ID if needed). Other systems use the
versioned `/api/v1/*` API with a bearer token from Settings > API access.

## Notes

- N1 printhead is 12 mm (96 dots @ 203 dpi): 14 mm labels have ~1 mm unprintable each side. M2 is 300 dpi, 48 mm.
- Pixel fonts need an entry in `packages/core/src/fonts.ts` (`pxPerEm`) to print crisply;
  measure with `node packages/core/scripts/font-grid.mjs font.ttf`.

## Licence

MIT, see [LICENSE](LICENSE). Fonts and libraries: [THIRD-PARTY.md](THIRD-PARTY.md).

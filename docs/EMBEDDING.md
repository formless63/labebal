# Embedding labebal in another app

labebal is two things:

- **The container** (`Dockerfile`, [deploy](DEPLOY.md)): the whole app with its own
  database and sign-in from the proxy. This is how most people run it.
- **The module** (`packages/app`, package `@labebal/app`): the same screens and
  API as a library, for mounting inside another app (yours, or anything
  else). The standalone app in `apps/web` is just one host of the module.

This page is about the module.

## What a host needs

| | Needs |
| --- | --- |
| Browser side | React 18.3 or 19. Any setup: Next.js, Vite, React Router, TanStack Start, Remix... |
| Server side | Something that answers web-standard requests with responses (`Request` -> `Response`): Next.js route handlers, Hono, Bun, Deno, React Router / TanStack Start resource routes, or Node via a small adapter (see the example). Node 20+. |
| Database | Postgres, through Drizzle (any driver: postgres-js, node-postgres, Neon, PGlite). labebal adds its own `label_*` tables. MySQL / SQLite are not supported. |
| Printing | Chrome or Edge (Web Bluetooth / Web Serial), on HTTPS or localhost. |

## Install

```sh
npm install @labebal/app @labebal/core drizzle-orm
# or: pnpm add / bun add / yarn add
```

The packages are compiled ES modules with type definitions. `@labebal/app` needs
React 18.3 or 19 and Drizzle 0.45 from your app.

**Next.js**: let Next bundle labebal, keep the embedded database out of the
bundle, and (for `output: "standalone"`) copy labebal's runtime files:

```ts
// next.config.ts
export default {
  serverExternalPackages: ["@electric-sql/pglite"],
  // only with output: "standalone"
  outputFileTracingIncludes: { "/labels/api/**": ["./node_modules/@labebal/app/{drizzle,assets,packs}/**"] },
};
```

Don't list `@labebal/app` in `serverExternalPackages`: its screens would get a
second copy of React. Start the server from the app's own folder, or set
`filesDir` (below), so labebal finds its migrations, fonts and packs.

**Plain Node, Vite, anything else**: no setup needed.

## Server

```ts
import { createLabebalServer } from "@labebal/app/server";

export const labebal = createLabebalServer({
  db,                                   // the host's Drizzle Postgres database
  basePath: "/labels",                  // the API answers at /labels/api/*
  user: async (req) => {                // who is signed in (null = nobody)
    const s = await getSession(req);
    return s ? { id: s.user.id, name: s.user.name, email: s.user.email, role: toLabebalRole(s.user) } : null;
  },
});
```

Send every request under `${basePath}/api/` to `labebal.handler(request)`. In Next.js:

```ts
// app/labels/api/[...path]/route.ts
import { labebal } from "@/lib/labebal";
const handle = (req: Request) => labebal.handler(req);
export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
```

Then call `labebal.start()` once at server start (Next: `instrumentation.ts`)
for background work (data-source syncs, webhook retries, backups), or pass
`jobs: "host"` and call `labebal.runJobs()` from your own job runner every ~30 s.

### Options (`LabebalServerOptions`)

| Option | Default | |
| --- | --- | --- |
| `db` | `DATABASE_URL`, else embedded PGlite | Drizzle Postgres database (or a function returning one). |
| `migrate` | `true` | Run labebal's migrations on first use. They are tracked in `drizzle.__labebal_migrations`, apart from the host's own. With `false`, call `migrateLabebal(db)` yourself. |
| `user(req)` | proxy headers (`LABEBAL_AUTH_HEADERS`), else everyone is admin | The signed-in person: `{ id, name?, email?, role, groups? }` or null. `id` keys per-person settings and GitHub accounts. |
| `anonymousRole` | `"viewer"` | Role when `user` returns null. |
| `basePath` | `""` | Mount point, e.g. `/labels`. Must match the client's `basePath`. |
| `publicUrl` | `LABEBAL_PUBLIC_URL`, else the request origin + `basePath` | Where label QR codes (`{{labelUrl}}`) point. |
| `env` | `process.env` | Any `LABEBAL_*` setting from [deploy](DEPLOY.md), e.g. `{ LABEBAL_GITHUB_CLIENT_ID: "" }`. Wins over the environment. |
| `jobs` | `"timer"` | `"host"` = no timer; call `runJobs()` yourself. |
| `features.backups` | `true` | labebal's own backups (`/api/backup`, scheduled zips). Turn off when the platform backs up the database. |
| `features.apiTokens` | `true` | labebal's API tokens for `/api/v1`. Turn off and pass `apiAuth` to use the host's API keys instead. |
| `apiAuth(req)` | none | Checks a bearer token for `/api/v1/*`: return a user or null. |
| `filesDir` | the package folder, or `node_modules/@labebal/app` under the working directory | Where `drizzle/`, `assets/` and `packs/` are. Set it when a bundler moves the server code and the working directory is somewhere else. |

### Roles

`viewer` < `printer` < `editor` < `admin`. Viewers see everything, printers print
and record history, editors change templates, labels and data, admins manage
packs, sources, webhooks, tokens and backups. Map the host's roles onto these in
`user()`.

## Browser

```tsx
import { LabebalApp } from "@labebal/app";

// Render it for every path under /labels (e.g. app/labels/[[...slug]]/page.tsx).
export default function Labels() {
  return <LabebalApp basePath="/labels" chrome="embedded" className="h-[calc(100dvh-4rem)]" />;
}
```

labebal routes inside `basePath` itself (History API), so the host only needs a
catch-all route that renders the component. In Next.js the page needs nothing
else; it can stay a static page.

| Prop | Default | |
| --- | --- | --- |
| `basePath` | `""` | Same as the server's. |
| `chrome` | `"full"` | `"embedded"` drops labebal's name and user badge from its header (the host shows its own). |
| `className` | 100dvh tall (full) / fills the parent (embedded) | Size of the box. |
| `colorScheme` | follow the host | `"light"`, `"dark"` or `"system"`. By default a `dark` class on `<html>` (or any ancestor) switches to dark, which is what most theme switchers set. |
| `router` | History API | `{ navigate(href, { replace }) }` to send navigation through the host's router. |
| `queryClient` | labebal's own | Share the host's TanStack Query client. |
| `serviceWorker` | none | URL of a service worker for offline use (the standalone app's `/sw.js`). |

Dialogs, menus and tooltips render inside the labebal box, not on `<body>`.

## Styles: two ways

**1. The host builds Tailwind 4 (theme follows the host).** For apps using
shadcn/ui tokens and a theme switcher:

```css
@import "tailwindcss";
@import "@labebal/app/tailwind.css"; /* adds labebal's files to Tailwind's sources */
```

labebal uses shadcn's colour tokens (`bg-background`, `text-muted-foreground`,
`border-border`, ...), so whatever theme the host applies, labebal follows. A
Tailwind host without shadcn tokens also imports `@labebal/app/theme.css`
(default neutral tokens plus the Tailwind mapping).

**2. Prebuilt (no Tailwind needed).**

```ts
import "@labebal/app/styles.css";
```

One stylesheet with everything, every rule scoped to `.labebal`, so it does not
touch the host page (build it with `pnpm --filter @labebal/app build:css`). Its
colours are CSS variables on `.labebal` that the host can override:

```css
.labebal { --primary: oklch(0.45 0.12 150); --radius: 0.25rem; }
```

The host's own element styles (e.g. `button { ... }`) still reach inside, as
with any embedded widget; labebal's classes win over plain element selectors.

## Example

`examples/vite-host` is a host with no Next.js and no Tailwind: a Vite + React
page with its own header, labebal at `/labels` with the prebuilt styles, and a
plain `node:http` server passing `/labels/api/*` to the handler, its own PGlite
database and a fixed signed-in user.

```powershell
pnpm --filter @labebal/app build:css
pnpm --filter labebal-example-vite-host dev
```

Then open http://localhost:5180/labels.

## Versions

Both packages are released together with the same version number. Before 1.0, a
minor version can change props, options or the template format; the release
notes say so. Database migrations run by themselves and only go forward, so back
up before updating.

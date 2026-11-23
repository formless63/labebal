# labebal API

Two kinds of endpoints:

| Prefix | Who calls it | Auth |
| --- | --- | --- |
| `/api/v1/*` | **Other systems** (inventory, scripts, spreadsheets with Apps Script...) | **Bearer token**, always. |
| `/api/*` (everything else) | The labebal web app in the user's browser | **None in the app.** Put labebal behind an authenticating reverse proxy (Pangolin, optionally with Pocket ID) so only signed-in people reach it. |

Do not expose the browser-facing `/api/*` routes to the internet without that
proxy: anyone who can reach them can read and change everything. If the proxy
protects the whole site, let `/api/v1/*` through without the proxy's login
(the token protects it), e.g. a Pangolin resource rule that bypasses auth for
the `/api/v1/` path, so machines can call it.

## Tokens

Create one in **Settings > API access** (one per system, so you can revoke one
without breaking the others). The token (`lbl_...`) is shown once; only a
SHA-256 hash is stored. Revoking takes effect immediately.

```sh
export LABEBAL=https://labels.example.com
export TOKEN=lbl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Errors: `401` with `{"error": "..."}` for a missing / invalid / revoked token,
`400` with `{"error": "invalid body", "issues": [...]}` for a bad request.

## GET /api/v1/templates

Templates and the fields their labels can fill.

```sh
curl -H "Authorization: Bearer $TOKEN" $LABEBAL/api/v1/templates
```

```json
[{ "id": "t-drawer-bin", "name": "Drawer bin (Akro-Mils)", "design": { "w": 30, "h": 12 },
   "fields": [{ "key": "title", "label": "Part name", "type": "text" }, ...], "tags": ["drawers"], ... }]
```

## POST /api/v1/labels

Create or update labels. Identify each label either by `id`, or by
`templateId` + `key` (your record key, e.g. a SKU): the id is then
`l-<template without t->-<key slug>`, e.g. `t-drawer-bin` + `SCR-M3-8` ->
`l-drawer-bin-scr-m3-8`, so sending the same key again updates the same label.

```sh
# One label
curl -X POST $LABEBAL/api/v1/labels \
  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"templateId":"t-drawer-bin","key":"SCR-M5-20","name":"M5 x 20",
       "values":{"title":"M5 × 20 socket head","spec":"DIN 912","icon":"mdi:screw-machine-round-top","code":"SCR-M5-20"}}'

# Several; merge=true keeps existing values you don't send
curl -X POST $LABEBAL/api/v1/labels \
  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"merge":true,"labels":[
        {"templateId":"t-drawer-bin","key":"SCR-M5-20","values":{"spec":"DIN 912 · A4"}},
        {"id":"l-muncher-1","templateId":"t-muncher","values":{"title":"SNACKS"}}]}'
```

Label fields: `id` or `key` (one required), `templateId`, `name` (defaults to
the existing name, then the key), `values` (field key -> text; numbers are
turned into text), optional `overrides`, `invert`, `tags`.

Response: `{"created": [ids], "updated": [ids], "errors": [{"index": 1, "error": "unknown templateId ..."}]}`
(status 400 only when nothing could be saved).

## POST /api/v1/datasets/:id/rows

Add rows to a dataset (the tables under **Data**). Rows are objects keyed by
column name (or column id); unknown columns are added. With a key column, rows
whose key matches an existing row are updated (only the cells you send),
others are appended. The dataset id is shown under the table on the Data page
("ID for the API"); the sample is `ds-drawer-akro`.

```sh
curl -X POST $LABEBAL/api/v1/datasets/ds-drawer-akro/rows \
  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"applyLabels":true,"rows":[
        {"SKU":"NUT-M5","Category":"Nuts","Part":"M5 hex nut","Spec":"DIN 934","Drawer":"A8"},
        {"SKU":"NUT-M3","Spec":"DIN 934 · A4 stainless"}]}'
```

Body: `rows` (required), `mode` (`"upsert"` default when there is a key
column, or `"append"`), `key` (column name/id to match on; defaults to the
key column chosen on the dataset's "Label design" tab), `applyLabels`
(also create/update the dataset's labels, with its rules, afterwards).

Response: `{"added": 1, "updated": 1, "rows": 17, "labels": {"created": 1, "updated": 16, "labelIds": [...], "skipped": []}}`

Up to 50,000 rows per request; the server writes them in batches and never
loads the dataset's existing rows (only their keys), so pushing 5,000 rows
into a large dataset takes about a second. Send bigger imports in several
requests.

## GET /api/v1/datasets/:id/rows

Read rows back, a page at a time.

```sh
curl -H "Authorization: Bearer $TOKEN" "$LABEBAL/api/v1/datasets/ds-drawer-akro/rows?q=nut&sort=sku&limit=50&offset=0"
```

Query: `q` (text contained in any cell, case-insensitive), `column` (search
only this column id), `sort` (column id; case-insensitive text order),
`dir` (`asc` / `desc`), `offset`, `limit` (default 200, max 50,000), `ids`
(comma-separated row ids).

Response: `{"columns": [{"id": "sku", "name": "SKU"}, ...], "total": 4, "offset": 0, "rows": [{"id": "r-...", "values": {"sku": "NUT-M3", ...}}]}`
(`total` counts all rows matching the search, not just this page).

Printing still happens from a browser: pushed labels appear in the library;
add them to the print queue (or a stock run) and print.

## GET /api/v1/counters

Persistent counters (Settings > Counters) and their current values. `?id=box`
for one counter.

```sh
curl -H "Authorization: Bearer $TOKEN" "$LABEBAL/api/v1/counters?id=box"
```

```json
{ "id": "box", "name": "Box number", "scope": "value", "keyField": "sku", "reset": "daily", "start": 1, "format": "0000",
  "values": [{ "key": "t-drawer-bin/SCR-M3-8", "next": 13, "nextNow": 1, "period": "2026-11-18", "watched": null, "updatedAt": "..." }],
  "updatedAt": "..." }
```

`key` is the scope key: `""` for a single shared sequence (`scope: "global"`),
the template id (`"template"`), or template id + `/` + field value (`"value"`).
`next` is the stored next number; `nextNow` is what the next reservation gets
right now (the start number when a day / week / month / year reset is due).

## POST /api/v1/counters

Reserve numbers so another system (or a label printed elsewhere) never reuses
a number the labels got. Reservations are atomic: concurrent calls and browser
prints always get separate, gap-free blocks. The counter must exist (create it
in Settings > Counters; the browser creates counters used in templates on their
first print).

```sh
# 5 numbers from a shared counter
curl -X POST $LABEBAL/api/v1/counters \
  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"counter":"box","n":5,"source":"ERP order 1234"}'

# A per-SKU counter: give the template + values (or the scope key directly), several at once
curl -X POST $LABEBAL/api/v1/counters \
  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"items":[{"counter":"serial","templateId":"t-drawer-bin","values":{"sku":"SCR-M3-8"},"n":2},
               {"counter":"serial","key":"t-drawer-bin/NUT-M3","n":1}]}'
```

Item fields: `counter` (id), `n` (1-100,000, default 1), and for counters
that are not global either `key` or `templateId` + `values` (the field the
counter is keyed by); `watched` (or the watched field in `values`) for
counters that restart when a field changes (e.g. a lot number).

Response: `{"reservations": [{"counter": "box", "key": "", "from": 41, "to": 45, "format": "0000"}]}`
(`from` / `to` inclusive, one entry per item, in order). Errors: `400` for an
unknown counter or a missing key. Each block is logged with source
`api:<token name>` (shown under the counter in Settings).
## POST /api/v1/print-requests

Ask for a print. The request waits in the **Inbox** (nav badge shows how many)
until someone at a browser approves it (the label goes into that browser's
print queue, created first if needed) or rejects it. Nothing prints by itself.

```sh
# An existing label
curl -X POST $LABEBAL/api/v1/print-requests \
  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"labelId":"l-drawer-bin-scr-m3-8","qty":2,"note":"Drawer A3 relabel","requestedBy":"inventory"}'

# A label by template + record key, created on approval from the values
curl -X POST $LABEBAL/api/v1/print-requests \
  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"templateId":"t-drawer-bin","key":"NUT-M6","values":{"title":"M6 hex nut","code":"NUT-M6"},"qty":1}'
```

Body: `labelId`, or `templateId` with `key` and/or `values` (a key without
values must name an existing label `l-<template>-<key>`; with values the label
is created / updated on approval, tagged `inbox`), `name`, `qty` (1-999,
default 1), `note`, `requestedBy` (free text shown in the inbox).

Response `201`: `{"id": "pr-...", "status": "pending", "labelId": ..., "templateId": ..., "key": ..., "qty": 2, "note": "...", "requestedBy": "...", "createdAt": "...", "decidedAt": null, "decidedBy": "", "reason": ""}`
(`404` for an unknown label / template).

## GET /api/v1/print-requests/:id

The same object; `status` is `pending`, `approved` (added to a browser's
print queue; `labelId` is then set, `decidedBy` is the approver's name from
Settings > You) or `rejected` (`reason`). `GET /api/v1/print-requests?status=pending&limit=50`
lists recent requests. To be told instead of polling, use a webhook.

## Webhooks (outgoing)

Settings > Webhooks: each URL gets a `POST` with a JSON body
`{"id": "whd-...", "event": "print", "createdAt": "...", "data": {...}}` on:

| Event | `data` |
| --- | --- |
| `print` | The history entry (printer, size, items with label ids / names / qty, who). |
| `void` | The voided history entry (sent by the history code when voiding exists). |
| `request.created`, `request.approved`, `request.rejected` | The print request as returned by `GET /api/v1/print-requests/:id`. |
| `source.synced`, `source.failed` | `{ datasetId, ok, fetched, added, updated, error?, ... }` after a live data-source sync. |
| `ping` | "Test" button. |

Headers: `X-Labebal-Event`, `X-Labebal-Delivery` (the id, stable across
retries; deduplicate on it), `X-Labebal-Timestamp` (Unix seconds) and
`X-Labebal-Signature: sha256=<hex>` = HMAC-SHA256 of `<timestamp>.<raw body>`
with the webhook's secret. Verify it (and reject old timestamps):

```js
const want = "sha256=" + crypto.createHmac("sha256", SECRET).update(`${req.headers["x-labebal-timestamp"]}.${rawBody}`).digest("hex");
const ok = crypto.timingSafeEqual(Buffer.from(want), Buffer.from(req.headers["x-labebal-signature"]));
```

Any 2xx counts as delivered (10 s timeout, redirects not followed). Otherwise
it is retried after 30 s, 2 min, 10 min, 1 h and 6 h, then marked failed
(Settings shows recent deliveries with a Retry button). Retries run in the
server process (see "Background jobs" below).

## Live data sources

A dataset can follow a Google Sheet, a CSV URL or a JSON API (Data > a
dataset > **Live source**). The **server** fetches it on "Sync now" or every N
minutes and upserts rows by the key column (no key: every sync replaces all
rows). JSON: `Rows at` is a JSONPath-ish selector (`$.data.items[*]`,
`results`, empty = the first array found); columns map a name to a path inside
each row (`sku`, `attrs.size`, `tags[0]`; none = every field, nested ones as
`a.b`). An optional header (e.g. `Authorization: Bearer ...`) is stored on the
server and never sent back to the browser.

Limits: 20 s timeout, 20 MB response, 50,000 rows, at most 5 redirects.
Google Sheets links (`/edit#gid=...` shared "anyone with the link", or
"Publish to web") are turned into their CSV export URL.

**Outgoing requests are SSRF-guarded** (sources and webhooks): only http(s),
no credentials in the URL, no `localhost` / single-label / `.local` /
`.internal` names, and every DNS answer and redirect hop is checked at
connect time, so private, loopback, link-local (169.254.x, cloud metadata),
CGNAT, multicast and IPv4-mapped / NAT64 forms are refused. To allow LAN
services (n8n, a NAS) set `LABEBAL_FETCH_ALLOW` to a comma list of host names,
IPs or IPv4 CIDRs (`n8n.lan,192.168.1.20,10.0.0.0/8`; `*` disables the check).

### Background jobs

Scheduled syncs and webhook retries run on a 30 s timer inside the Node
server (`src/instrumentation.ts` -> `server/scheduler.ts`). They only run while
the server runs (fine for the Docker image; not for serverless), and with
several server instances on one Postgres each instance syncs (harmless:
upserts are idempotent; duplicate webhook retries are possible).
`LABEBAL_SCHEDULER=off` disables the timer.

## Browser-facing endpoints (no token; behind the proxy)

| Method | Path | |
| --- | --- | --- |
| GET | `/api/library` | All templates + labels. |
| POST | `/api/import` | Merge `{ templates, labels }`. |
| PUT / DELETE | `/api/templates/:id`, `/api/labels/:id` | Save / delete. |
| GET | `/api/labels/:id` | Label page data (what `/l/:id` shows; viewers): `{ label, template, folder, fields: [{ key, label, value, href? }], url, recordUrl?, source?: { datasetId, datasetName, rowId, cells: [{ name, value, href? }] }, notes: { text, updatedBy, updatedAt } \| null, prints: [{ historyId, printedAt, who, printer, sizeName, qty }] }`. `url` uses `LABEBAL_PUBLIC_URL`, else the request origin (`x-forwarded-host` / `-proto` honoured); `recordUrl` is the template's record link filled with the label's values (only when it is an absolute http(s) URL). 404 when the label is gone. |
| PUT | `/api/labels/:id/notes` | Editors: `{ notes }` ("" clears) -> `{ text, updatedBy, updatedAt }`. |
| GET | `/api/config` | `{ publicUrl }`: `LABEBAL_PUBLIC_URL` or null (the browser then uses its own origin for `{{labelUrl}}`). |
| GET / POST | `/api/datasets` | List (summaries with row counts) / create (rows included). |
| GET | `/api/datasets/:id` | Metadata + `rowCount` (no rows); `?rows=all` returns the whole dataset with rows. |
| PATCH | `/api/datasets/:id` | `{ name?, columns?, link? }` (`link: null` unlinks). Removing a column drops its cells. |
| PUT / DELETE | `/api/datasets/:id` | Replace everything (rows included) / delete. |
| GET | `/api/datasets/:id/rows` | A page of rows: `?q=&column=&sort=&dir=&offset=&limit=&ids=` -> `{ total, offset, rows }`. |
| POST | `/api/datasets/:id/rows` | Append / upsert records `{ rows, mode?, key? }` -> `{ added, updated, rows, ids, newColumns }`. |
| PATCH | `/api/datasets/:id/rows` | Merge cells into many rows `{ updates: [{ id, values }] }`. |
| DELETE | `/api/datasets/:id/rows` | `{ rowIds: [...] }` or `{ filter: { q, column?, excludeIds? } }` -> `{ deleted }`. |
| PATCH / DELETE | `/api/datasets/:id/rows/:rowId` | Merge cells `{ values }` / delete one row. |
| PUT | `/api/datasets/:id/rows/:rowId/cells/:column` | Set one cell `{ value }`. |
| POST | `/api/datasets/:id/labels` | Create / update one label per row: `{ rowIds: [] }`, `{ filter: { q, column?, excludeIds? } }`, or `{}` for all rows. |
| GET / POST | `/api/runs`, PUT / DELETE `/api/runs/:id` | Stock runs. |
| GET / POST | `/api/boards`, PUT / DELETE `/api/boards/:id` | Quick print boards: `{ id, name, notes, tiles: [{ labelId, sizeId, qty }] }` (editor to change). |
| GET / POST | `/api/history` | Print history (`?q=&source=&printer=&who=&from=&to=&before=&voided=exclude\|only&labelId=&limit=`; `who=-` = no name) / record a print (`who` = the browser's name from Settings > You). Items may carry `values` (resolved), `overrides` and `thumb` (1-bit PNG data URL, first 60 items); the server adds `templateVersion`. |
| GET | `/api/history/people` | Names that printed, with job counts. |
| GET | `/api/history/:id` | One entry; `?snapshot=1` adds `templates` (the template versions its items printed with, for "reprint as printed"). |
| PATCH | `/api/history/:id` | Void / un-void: `{ voided: true, reason }` (entry kept, marked with `voidedAt`, `voidReason`, `voidedBy`). |
| DELETE | `/api/history/:id` | Remove an entry. |

### Template versions, sharing, import

Template saves (`PUT /api/templates/:id`, `POST /api/import`) are recorded in the version history: saves by the
same person within 30 minutes roll into one version; printing with a version freezes it. "Who" is the proxy's
`Remote-User` header, else `x-labebal-who` (URI-encoded name from Settings > You).

| Method | Path | |
| --- | --- | --- |
| GET | `/api/templates/:id/versions` | Versions, newest first (`?docs=0` without documents). |
| POST | `/api/templates/:id/versions` | "Save version": `{ note }` pins the current design. |
| GET / DELETE | `/api/templates/:id/versions/:versionId` | One version / delete it. |
| POST | `/api/templates/:id/versions/:versionId` | `{ "action": "restore" }`: make it the current design (recorded as a new version). |
| GET | `/api/templates/:id/share` | Download `<name>.labebal.json`: the template + the uploaded images, icons and fonts it uses (base64); `?labels=1` adds its labels. |
| POST | `/api/import/template` | Body: a `.labebal.json` or zip (`template.json` + `assets/<id>`). Same template id already there: `409 { conflict }` unless `?mode=replace` or `?mode=copy` (new ids). |

NiimBlue JSON, ZPL and P-touch `.lbx` files are converted in the browser (core `importNiimBlue`, `importZpl`,
`importLbxFiles`) and saved with `POST /api/import`.

### Backup

| Method | Path | |
| --- | --- | --- |
| GET | `/api/backup` | Download a full backup zip now; `?status=1` returns the schedule and the backups stored on the server. |
| POST | `/api/backup` | Write a backup into the server's backup directory now. |
| POST | `/api/backup/restore` | Body: backup zip (or `?file=<stored name>`). `?mode=merge` (default: add missing rows, keep existing) or `?mode=replace&confirm=replace` (empties every `label_*` table first). `?dryRun=1` only checks and returns the plan. |
| GET | `/api/backup/files/:name` | Download a stored backup. |

```sh
curl -o labebal.zip $LABEBAL/api/backup
curl -X POST --data-binary @labebal.zip "$LABEBAL/api/backup/restore?mode=replace&confirm=replace"
```
| GET / POST | `/api/tokens`, DELETE `/api/tokens/:id` | List / create (token returned once) / revoke. |
| GET / POST | `/api/counters` | Counters with values / create or update a definition `{ id, name?, scope, keyField?, reset, watchField?, start, format? }`. |
| GET / PUT / DELETE | `/api/counters/:id` | One counter + `log` of recent blocks (`?limit=`) / update definition / delete. |
| PUT | `/api/counters/:id/value` | `{ key?, next }` sets the next number; `{ key? }` without `next` resets (no `key` = every key). |
| POST | `/api/counters/reserve` | Reserve for a browser print: same body as `POST /api/v1/counters`; unknown counters are created. |
| GET / POST | `/api/sources`, `/api/sources/preview` | All live sources / try a source config without saving -> `{ total, columns, sample, warnings }`. |
| GET / PUT / DELETE | `/api/sources/:datasetId` | A dataset's source (or `null`) / link or change (`headerValue` omitted = keep) / unlink. |
| POST | `/api/sources/:datasetId/sync` | Sync now -> `{ ok, fetched, added, updated, removed, rows, newColumns, labels?, error? }`. |
| GET | `/api/inbox?status=&before=&limit=`, `/api/inbox/count` | Print requests / `{ pending }` (nav badge). |
| POST | `/api/inbox/:id/approve`, `/api/inbox/:id/reject` | `{ qty?, who? }` -> `{ request, labelId, qty }` (the browser then enqueues) / `{ reason?, who? }`. |
| GET / DELETE | `/api/inbox/:id` | One request / remove it from the list. |
| GET / POST | `/api/webhooks` | `{ events, webhooks }` / create `{ name?, url, events? }` (returns the secret). |
| PATCH / DELETE | `/api/webhooks/:id` | `{ name?, url?, events?, enabled?, rotateSecret? }` / delete. |
| GET | `/api/webhooks/:id/secret`, `/api/webhooks/:id/deliveries` | Reveal the secret / recent deliveries (POST `{ ids }` retries now). |
| POST | `/api/webhooks/:id/test` | Send `ping`, return the delivery. |
| GET | `/api/scan?q=` | Scan lookup -> `{ labels: [{ id, name, match }], rows: [{ datasetId, rowId, preview, labelId?, labelExists }] }`. A scanned label page link (`https://host/l/<id>`, from `{{labelUrl}}`) is read as that label id; the Scan dialog then opens the label's page. |
| GET | `/api/scan?q=` | Scan lookup -> `{ labels: [{ id, name, match }], rows: [{ datasetId, rowId, preview, labelId?, labelExists }] }`. |

### Network printers

| Method | Path | Role | |
| --- | --- | --- | --- |
| GET | `/api/netprinters` | viewer | Network printers (`id, name, host, port, model, dpi, headDots, thermal`). |
| POST | `/api/netprinters/detect` | admin | `{ host, port? }` -> what the printer reports (~HI, ^HH). Prints nothing. |
| POST | `/api/netprinters` | admin | `{ name, host, port?, thermal?, dpi?, headDots?, model? }`; detects when dpi / headDots are missing. |
| PATCH / DELETE | `/api/netprinters/:id` | admin | Rename, move (detected again), ribbon use (`direct` / `transfer` / `both`). |
| GET | `/api/netprinters/:id/status` | viewer | ~HS: `paperOut, headOpen, ribbonOut, paused, thermalTransfer, remaining, queued, problem`. |
| POST | `/api/netprinters/:id/print` | printer | Body: ZPL text (as rendered by the browser), up to 32 MB. |
| POST | `/api/netprinters/:id/cancel` | printer | ~JA: drop what the printer still holds. |

### Packs

See [packs](PACKS.md). Changes need the `admin` role (reset: `editor`); viewers can list, refresh and export.
`GET /api/library` leaves out templates / labels of disabled packs and adds
`packs: { packs: [{ id, name, version, enabled }], items: { "template:<id>" | "label:<id>": { pack, changed } } }`.

| Method | Path | |
| --- | --- | --- |
| GET | `/api/packs` | `{ sources, installed }`: sources with their cached listing (packs, versions, templates + labels for previews; `hasToken`, `account: { id, login } \| null`, never a token) and installed packs (counts, `changed`, `deleted`, `available` newer version, `skipped` version, `dependents`). |
| POST | `/api/packs/sources` | Add a source `{ input, token?, accountId? }`: a URL to a manifest / collection / bundle, or GitHub `owner/repo[/path][@ref]`. `accountId` (one of the caller's connected GitHub accounts; GitHub sources only) reads it through the GitHub API with that account instead of a pasted token, pinned to the commit seen at the last check. Read before saving; `400 { error }` when nothing usable is there. |
| PATCH / DELETE | `/api/packs/sources/:id` | `{ token?, name?, accountId? }` (`token: null` clears, `accountId: null` stops using an account) / forget the source (installed packs stay). The built-in source can't be changed. |
| POST | `/api/packs/check-updates` | Admin. `{ force? }`: re-check sources older than `LABEBAL_PACK_CHECK_MINUTES` (all with `force`; GitHub sources with an account: commit SHA + ETag first, 304 = no re-read), then `[{ packId, name, from, to, sourceId, sourceName, added, removed, changed, kept }]` for installed packs with a newer, not skipped version: a dry run of the update planner over templates and labels (`kept`: changed here, `reason: changed` = the pack changed it too, `removed` = gone from the pack but kept as yours). Items are `{ kind, id, name }`. |
| GET | `/api/packs/installed/:id/preview` | Admin. The same dry run with `before` / `after` documents per item and `templates` / `templatesBefore` (id -> Template) for previews; 404 when no newer version. |
| POST | `/api/packs/installed/:id/skip` | Admin. `{ version }` stops update prompts for that version (`null` clears). |
| POST | `/api/packs/sources/:id/refresh` | Re-read the listing (errors land in `lastError`). |
| POST | `/api/packs/install` | `{ sourceId, packId, labelIds? }` -> `{ pack, inserted, updated, unchanged, adopted, kept, conflicts, removed, detached, warnings }`. |
| GET | `/api/packs/installed/:id` | Removal plan: `{ remove, changed: [{ kind, id, name, reason: changed\|used }], dependents }`. |
| PATCH | `/api/packs/installed/:id` | `{ enabled }`: disabled packs are hidden, not deleted. |
| POST | `/api/packs/installed/:id/update` | Refresh the source and update (same result as install). |
| DELETE | `/api/packs/installed/:id` | Remove; `?keepChanged=1` keeps changed items and templates other labels use as your own. |
| POST | `/api/packs/reset` | `{ items: [{ kind, id }] }` or `{ packId }`: back to the pack version (also restores items deleted here). |
| POST | `/api/packs/export` | `{ manifest: { id, name, version, ... }, templateIds, labelIds, datasets? }` -> zip of `<id>/labebal-pack.json` + files. |

### GitHub

See [packs](PACKS.md) (GitHub) and [deploy](DEPLOY.md) (GitHub). Accounts belong to
the caller: their user scope when identity headers are on (`401` when not
signed in), one shared instance scope when they are off. Responses never
contain tokens. GitHub problems come back as `{ error }` with 400 / 403 / 404 /
409 / 502; `401 { error, reconnect: true }` when GitHub no longer accepts an
account (it is then marked `status: "reconnect"`).

| Method | Path | |
| --- | --- | --- |
| GET | `/api/github` | `{ config: { app, installUrl, tokenUrl, readTokenUrl, classicTokenUrl, scope: user\|instance\|null, mock }, accounts: [{ id, login, name, avatarUrl, kind: app\|token, githubId, commitEmail, commitEmailOverride, defaultRepo, status: ok\|reconnect, lastError, createdAt, lastUsedAt }] }`. |
| POST | `/api/github/device` | "Connect GitHub": start the device flow -> `201 { id, userCode, verificationUri, expiresAt, interval }`. |
| GET / DELETE | `/api/github/device/:id` | Status `{ status: pending\|done\|denied\|expired\|error, error?, account? }`; the server asks GitHub at most once per `interval` (slow_down raises it). Poll every couple of seconds. DELETE cancels. |
| POST | `/api/github/accounts` | "Use a token instead": `{ token, repo? }`, checked with `GET /user` (and the repo) before saving -> `201 { account, repo? }`. |
| PATCH / DELETE | `/api/github/accounts/:id` | `{ commitEmail?, defaultRepo? }` (`""` / null resets) / disconnect. |
| GET | `/api/github/accounts/:id/repos` | `{ repos: [{ owner, name, fullName, private, defaultBranch, canWrite, htmlUrl, description }], installations, installUrl }` (App accounts: the repos of the App's installations). |
| POST | `/api/github/accounts/:id/repos` | Create a repo `{ name, private?, description? }` -> `{ created, repo?, needsInstall?, installUrl?, newRepoUrl?, reason? }`: `needsInstall` = created but the App's installation doesn't cover it (add it at `installUrl`); `newRepoUrl` = GitHub refused (no Administration permission), create it there (prefilled). |
| GET | `/api/github/accounts/:id/repos/:owner/:repo` | Packs already in the repo: `{ packs: [{ dir, id, name, version, description }], defaultBranch, canWrite }`. |
| POST | `/api/github/publish` | Editor. `{ accountId, owner, repo, branch?, dir, manifest: { id, name, description?, author?, folder? }, bump: patch\|minor\|major, version?, templateIds, labelIds, datasets }` -> `{ unchanged, version, commitSha, commitUrl, htmlUrl, summary: { added, removed, changed, first }, files: { added, changed, removed }, message }`. Builds the pack like `/api/packs/export` and writes it in one commit (Git Data API; an empty repo first gets a README through the Contents API): files in `dir` (`templates/`, `labels/`, ... and the manifest; other files there stay), `labebal-packs.json` updated when `dir` is set. Version = the published one bumped (none: 1.0.0); nothing changed = no commit (`unchanged`). Author: account name + `commitEmail`. |
| GET | `/api/github/published` | Editor. Packs published from this app: `[{ id, packId, accountId, accountLogin, owner, repo, branch, dir, name, version, templateIds, labelIds, datasets, commitUrl, publishedBy, publishedAt, changedSince, htmlUrl, ... }]` (`changedSince`: items added / changed / gone here since the last publish). |
| DELETE | `/api/github/published/:id` | Editor. Delete the pack's folder and collection entry from the repo in one commit (`?accountId=` to use another of your accounts) -> `{ removed, commitUrl }`. |

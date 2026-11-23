# Packs

A pack is a set of templates, labels, datasets, images and fonts kept as plain
files in a git repo (or one bundled JSON file). People add the pack's link in
**Settings > Packs**, pick the packs they want, and get updates when you bump the
version. Nothing is hard-coded in the app: even the samples on a fresh install are built-in packs you can turn off.

Code: core `packages/core/src/pack.ts` (format, CSV, links, merge rules; tests in
`packages/core/test/pack.test.ts`), app `packages/app/src/server/packs.ts`,
`packages/app/src/features/packs/*`, tables `label_pack_sources`, `label_packs`,
`label_pack_items`. Endpoints: [api](API.md) (Packs).

## Layout

```
my-packs/                     a git repo
  labebal-packs.json          optional collection: several packs in one repo
  drawers/
    labebal-pack.json         manifest
    templates/bin.json        core Template JSON (one, an array, or a library export)
    labels/bins.csv           labels: one row each (great for batches)
    labels/special.json       labels as JSON (Label, Label[] or { labels })
    datasets/parts.json       core Dataset JSON (id, name, columns, rows, link)
    assets/logo.png           images / SVG icons
    fonts/MyPixel.ttf         fonts
```

### Manifest `labebal-pack.json`

```json
{
  "$schema": "https://raw.githubusercontent.com/formless63/labebal/main/packs/schema/labebal-pack.schema.json",
  "id": "drawers",
  "name": "Drawer labels",
  "version": "1.2.0",
  "description": "Akro-Mils bins and faces",
  "author": "Me",
  "homepage": "https://github.com/me/my-packs",
  "folder": "Drawers",
  "templates": ["templates/bin.json"],
  "labels": ["labels/bins.csv", { "path": "labels/more.csv", "template": "t-bin", "folder": "Drawers/Big" }],
  "datasets": ["datasets/parts.json"],
  "assets": [{ "path": "assets/logo.png", "id": "a-logo" }, { "path": "assets/plug.svg", "id": "plug", "kind": "icon", "keywords": ["power", "socket"] }],
  "fonts": [{ "path": "fonts/MyPixel.ttf", "family": "My Pixel", "pixel": { "pxPerEm": 8, "linePx": 9 } }]
}
```

- `id` is how installs and updates are matched: never change it. `version` is semver; bump it to offer an update.
- Paths are relative to the manifest (no URLs, no leading `/`).
- `folder`: library folder for labels that don't name one (`/` nests). A label's own `folder:` tag / CSV `folder` wins.
- Item ids are kept as they are (template `id`, label `id`), so a pack can take over rows that already exist with the same ids.
- `assets`: templates refer to images as `/api/assets/<id>` and to SVG icons as `custom:<id>` (listed under Custom in the icon picker, by `name` and `keywords`). Without an `id`, it is `pa-<pack>-<file name>`.
- `fonts`: installed as uploaded fonts (Settings > Fonts) under `family`; `pixel` makes pixel fonts render crisp (measure with `pnpm --filter @labebal/core exec tsx scripts/font-grid.ts font.ttf`). Built-in fonts (Atkinson Hyperlegible Next, Roboto Condensed, JetBrains Mono, system fonts) need no entry.
- `minApp`, `license`: informational.

### Labels as CSV

```csv
id,name,template,folder,invert,tags,overrides,title,detail
l-bin-m3,M3 screws,t-bin,Drawers/Screws,,metric,,M3 × 8,A2 stainless
,M4 screws,t-bin,,,,"{""title"":{""sizePt"":7}}",M4 × 10,"two
lines"
```

- Reserved columns (any order, case-insensitive): `id`, `name`, `template`, `folder`, `invert` (yes / no), `tags` (`;` or `,` separated), `overrides` (JSON per node id, e.g. a smaller title on one label). Every other column is a template field key.
- An empty cell is an empty value. Leave a column out to use the template field's default.
- `template` can also come from the manifest entry (`{ "path": "...", "template": "t-bin" }`).
- No `id`: the label gets `l-<pack>-<name>` (`-2`, `-3` for repeats). Give ids if you plan to rename labels; otherwise a rename is a delete plus a new label.

### Collection `labebal-packs.json`

```json
{ "$schema": "https://raw.githubusercontent.com/formless63/labebal/main/packs/schema/labebal-packs.schema.json",
  "name": "My packs", "description": "Pick what you need", "packs": ["drawers/labebal-pack.json", "cables/labebal-pack.json"] }
```

Entries may also point at bundle files.

### Bundles

`pnpm packs bundle <dir>` writes one self-contained JSON (`format: "labebal.pack"`, files inlined, binaries
base64); on a collection it writes a `labebal.packs` file with every pack. Host it anywhere and add its URL.

### JSON Schemas

`packs/schema/*.schema.json` (generated from the zod schemas: `pnpm packs schema`): manifest, collection,
template files and label files. Point `$schema` at them for autocomplete in VS Code. The template schema
only checks the outline (`id`, `name`, `schema: 2`, `design`, `root`, `fields`); the full document model is
in [templates](TEMPLATES.md) and core `schema.ts`.

## Authoring workflow

1. Design in the app, then **Export as pack**: a template's menu (Templates page), a folder's menu, or the
   label list's Export menu / selection bar ("Pack"). You get `<id>-<version>.zip` with the manifest, templates,
   labels (CSV when it can hold them exactly, else JSON), datasets (optional) and the images / fonts they use.
   Or start from scratch: `pnpm packs new my-packs/drawers --name "Drawer labels"`.
2. Unzip into your pack repo, edit freely (CSV in a spreadsheet, JSON in an editor).
3. `pnpm packs check my-packs/drawers` (from a labebal checkout): validates the manifest and files, warns
   about labels pointing at templates the pack lacks, unknown field keys, fonts / assets used but not shipped,
   and renders every template and label headlessly (with `@napi-rs/canvas`), reporting render failures and
   preflight errors with the file they came from. `--no-render` skips rendering. Exit code 1 on errors.
4. Bump `version`, commit, push. Friends press Refresh (or just open Settings > Packs) and see "Update to x.y.z".

## Adding sources (Settings > Packs)

- GitHub shorthand: `owner/repo`, `owner/repo/path/in/repo`, `owner/repo@v1.2` (tag / branch / commit), also
  `github.com/owner/repo/tree/<ref>/<path>` links. Read from `raw.githubusercontent.com`; a folder tries
  `labebal-packs.json`, then `labebal-pack.json`.
- Any URL to a manifest, collection or bundle (`https://…/labebal-pack.json`). A URL ending in `/` tries both names.
- The server fetches with the SSRF-guarded fetch (`server/safe-fetch.ts`): private / LAN addresses are refused
  unless listed in `LABEBAL_FETCH_ALLOW`.

### Private repos

Easiest: connect GitHub (below) and add the source "With GitHub: <account>". Or paste a read-only token
with the source (GitHub: fine-grained token, only that repo, "Contents: read").
The token is stored on the server only (`label_pack_sources.token`), never sent to the browser (the UI only
sees "private"), and is sent as `Authorization: Bearer` only to the source's host (`raw.githubusercontent.com`
for GitHub sources; redirects to other hosts drop it). Server backups include it, like other integration secrets.

## GitHub: share packs without knowing git

Settings > Packs > **GitHub** does the GitHub side for you (editors and admins see it).
Code: `packages/app/src/server/github.ts` (accounts, device flow, repos), `server/github-publish.ts`,
`features/github/*`; tables `label_github_accounts`, `label_github_published`,
`label_pack_source_github`, `label_pack_update_skips`. Server setup: [deploy](DEPLOY.md) (GitHub).

### Connect

- **Connect GitHub**: labebal shows a code (big, with Copy and Open GitHub). Type it on GitHub, press
  Authorize, done. Nothing to configure, no token to understand.
- Then **Choose repositories**: GitHub only lets labebal see the repositories you pick (the "Only select
  repositories" option is fine). labebal links there when it can't see any yet.
- **Use a token instead**: the "Create a token on GitHub" button opens GitHub's fine-grained token page
  with the name, permissions (Contents: read and write, Metadata: read) and "no expiry" filled in; you
  pick the repositories and paste the token back. It is checked with GitHub before it is saved.
- You can connect several accounts (e.g. yours and a club's). Each shows the e-mail used on your
  published changes: GitHub's private `<id>+<login>@users.noreply.github.com` unless you change it.
- Accounts are yours only when the server knows who you are (sign-in through the proxy); without
  sign-in there is one shared set for the whole labebal. Tokens never leave the server.

### Where your packs live

One repository holds all your packs: `labebal-packs.json` at the top lists them and each pack has its
own folder. **Create a repo for my packs** makes one (`labebal-packs`, private unless you switch it to
public). If GitHub doesn't allow that (the App or token lacks the permission), labebal opens GitHub's
"new repository" page already filled in; create it there and pick it. Any repository you can write to
works too, also an existing single-pack repo (`labebal-pack.json` at the top).

### Publish

On the Templates page or in the label list, **Export as pack** > **Publish to GitHub…**: pick the
repository (and the account, if you have several), "A new pack" or "Update <pack>", a name and a short
description. labebal builds the same files as the zip export and writes them as **one change** (one
commit), adds the pack to `labebal-packs.json`, and sets the version: 1.0.0 the first time, then up by
one each time ("Small fix" 1.0.1, "New labels" 1.1.0, "Big change" 2.0.0). The change says what
happened ("3 added, 1 removed, 2 changed"). Nothing changed: nothing is written.

**My packs** (in the GitHub area) lists what you published, where, and the last version. When labels or
templates in it changed here since, it says so: **Publish update**. The trash button deletes the pack's
folder from the repository (one change; GitHub keeps the history, your labels here are untouched).

Your friends add your repository (`you/labebal-packs`) as a source.

### Follow

Adding a source works as before (link or `owner/repo`). With a connected account you can pick
**With GitHub: <you>** instead of pasting a token: private repos you can see just work, the pack is
read through GitHub's API (no 5-minute raw-file cache), and checking for updates costs one tiny
request (the latest commit's id; unchanged = nothing else is read).

### Updates while you work

Admins get a small notice when a pack they installed has a newer version, e.g.
"Cable labels 1.1.0: 3 added, 1 removed, 2 changed". labebal checks when you come back to the tab or
move between pages, at most every 5 minutes (Settings > Packs has **Check for updates now**).
**Review** shows the templates and labels the update adds, changes (before → after), removes, and keeps
because you changed them, with previews; then **Apply update**, **Skip this version** (no more reminders
until the next one) or **Later**. The counts are a dry run of the same rules as the update itself
(see below); datasets, images and fonts come along with the update but aren't listed.

## Installing, updating, removing

- **Install** copies the pack's items into the library and records the pack's version of each
  (`label_pack_items`: hash + document). **Choose labels…** installs only some labels (all templates come
  along); updates then bring only those.
- **Badges**: pack items show a small pack marker in the template list and the label list; an amber dot means
  "changed here". Their menu has **Reset to pack version**.
- **Disable** hides the pack's templates, labels and datasets (and labels on its templates) from the library and
  print UI; nothing is deleted. **Enable** shows them again.
- **Update** (shown when the source offers a newer version after a refresh):
  - items unchanged here get the new version; new items are added;
  - items changed here are kept and listed ("N changed here", reset restores the pack version);
  - items deleted here stay deleted ("Restore N deleted" brings them back);
  - items gone from the pack are deleted if unchanged, otherwise kept as your own;
  - moving a pack label to another folder is not a change, and updates keep your folder;
  - template updates are recorded in the version history (`who` = `pack:<id>@<version>`).
- **Remove** deletes unchanged items. Items changed here, and templates your own labels use (deleting a
  template deletes its labels), are listed and you choose: keep them as your own or delete everything.
- An item id can belong to one pack; a second pack with the same id skips it (reported as a conflict).

## Built-in packs

`packages/app/packs/examples`, `standards` and `welcome` ship with the module (Docker copies `packages/app/packs`;
`LABEBAL_BUILTIN_PACKS` points to the Examples folder elsewhere, the others are read from its siblings `standards` and `welcome`).
All are listed under "Built-in packs" and read from disk only.

- **Label Muncher** (`welcome`): installed on a new, empty library, so there is something to print.
- **Examples**: listed, not installed by default.
- **Standard formats**: installed (enabled) the first time the built-in source offers it; turn it off or remove it
  in Settings > Packs and it stays that way. Templates after common label standards: GS1 logistic label (SSCC) and
  UDI, ANSI Z535.4 safety label, NFPA 70E arc flash, GHS / OSHA HazCom container, NFPA 704 diamond, TIA-606 cable
  ID, ECIA EIGP 114 reel, asset tag, shelf price label. Generated by `packages/app/scripts/standards-pack.mjs`
  (edit the script, run `node scripts/standards-pack.mjs` in `packages/app`, bump the version for an update).
  The layouts follow each standard's published structure; Z535, TIA-606 and NFPA are paid documents, so labels
  that must comply need checking against them. Pictograms are icon stand-ins, not the official artwork.

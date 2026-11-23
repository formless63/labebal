# Deploying labebal

labebal is one container: the Next.js server plus an embedded Postgres
(PGlite) whose files live in a volume. Printing happens in the user's browser
over Web Bluetooth / Web Serial; the server only talks to network (ZPL) printers.

## Run it

```sh
docker run -d --name labebal -p 3000:3000 -v labebal-data:/data --restart unless-stopped ghcr.io/formless63/labebal:latest
# -> http://localhost:3000 (Bluetooth works on localhost)
```

Images are built for amd64 and arm64. `latest` follows the `main` branch; pin a
release with a version tag such as `0.1.0`.

Or build it yourself from a checkout:

```sh
docker compose up -d --build
```

On first start the server runs the Drizzle migrations and sets up the
built-in packs (the first request to `/api/library` triggers it). Check:

```sh
curl http://localhost:3000/api/library   # { templates: [...], labels: [...] }
docker inspect --format '{{.State.Health.Status}}' labebal
```

| Variable | Default | |
| --- | --- | --- |
| `LABEBAL_DATA_DIR` | `/data/pglite` | Embedded database directory (keep it on the `/data` volume). |
| `DATABASE_URL` | unset | Use a real Postgres instead (same schema; migrations run on start). See the commented `postgres` service in `compose.yaml`. |
| `PORT` / `HOSTNAME` | `3000` / `0.0.0.0` | Listen address. |
| `LABEBAL_PUBLIC_URL` | unset | The address people open labebal on, e.g. `https://labels.example.com`. QR codes made with `{{labelUrl}}` print `<this>/l/<label id>` (the label's page), so set it to an address phones can reach (through the proxy). Unset: the address of the browser that prints. Changing it later does not change labels already printed. |

## HTTPS is required

Web Bluetooth and Web Serial only work in **Chrome / Edge** on **HTTPS** pages
(or `http://localhost`). Opening `http://<server-ip>:3000` from another
machine shows the app but the *Connect printer* button stays disabled. Put it
behind a TLS reverse proxy.

### Behind Pangolin

1. In Pangolin, add a resource (HTTP) for a hostname such as
   `labels.example.com`, target `http://<docker-host>:3000` (or the container
   name if Newt runs on the same Docker network).
2. Pangolin terminates TLS, so the browser sees HTTPS and Bluetooth works.
3. Leave the port unpublished (`ports:` removed) if Newt reaches the container
   on a shared network; then the only way in is through Pangolin.
4. Authentication: labebal has no login of its own. Turn on Pangolin's resource
   authentication (SSO users / roles, or a PIN / password) for the resource,
   and optionally let labebal read who is signed in (next section).

### Users and roles (from the proxy)

With SSO in front, the proxy tells the app who the user is in request headers.
labebal can use them to record **who printed** (History) and to apply
**roles**. It is off by default: with none of these variables set, headers are
ignored and everyone can do everything, as before.

Only turn it on when the proxy is the *only* way in (port not published) and it
**overwrites** these headers on every request, otherwise anyone can claim to be
anyone by sending them. Pangolin, Authelia, oauth2-proxy and authentik all
replace them.

| Variable | Default | |
| --- | --- | --- |
| `LABEBAL_AUTH_HEADERS` | unset | `true` turns identity on with the default header names below. |
| `LABEBAL_HEADER_USER` | `Remote-User, X-Forwarded-User, X-Auth-Request-User, X-authentik-username, X-Remote-User` | Username header(s), first one present wins. Setting any `LABEBAL_HEADER_*` also turns identity on and replaces that list. |
| `LABEBAL_HEADER_EMAIL` | `Remote-Email, X-Forwarded-Email, X-Auth-Request-Email, X-authentik-email` | |
| `LABEBAL_HEADER_NAME` | `Remote-Name, X-Forwarded-Preferred-Username, X-Auth-Request-Preferred-Username, X-authentik-name` | Display name. |
| `LABEBAL_HEADER_GROUPS` | `Remote-Groups, Remote-Role, X-Forwarded-Groups, X-Auth-Request-Groups, X-authentik-groups` | Comma, semicolon or `\|` separated (or a JSON array). |
| `LABEBAL_ROLE_ADMIN` / `_EDITOR` / `_PRINTER` / `_VIEWER` | unset | Comma-separated group names (case-insensitive) for each role; `user:<name or e-mail>` matches one person, `*` everyone signed in. The highest matching role wins. |
| `LABEBAL_DEFAULT_ROLE` | `admin` without role variables, else `viewer` | Signed-in users who match no group. |
| `LABEBAL_ANONYMOUS_ROLE` | same as the default role | Requests without a user header (e.g. Pangolin PIN / password access). |

What the proxies send: **Pangolin** forwards `Remote-User`, `Remote-Email`,
`Remote-Name` and `Remote-Role` for SSO logins (e-mail one-time-passcode logins
only send `Remote-Email`, which labebal then uses as the user; PIN / password
access sends none). **Authelia** / Caddy `forward_auth` send `Remote-User`,
`Remote-Groups`, `Remote-Email`, `Remote-Name`. **oauth2-proxy** (e.g. with
Pocket ID as the OIDC provider) sends `X-Forwarded-User` / `-Email` /
`-Preferred-Username` / `-Groups` with `--pass-user-headers`, or
`X-Auth-Request-*` with `--set-xauthrequest`. **authentik** sends
`X-authentik-username` / `-email` / `-name` / `-groups` (`|` separated).
Pocket ID groups reach the app through whichever proxy sits in front.

Roles (each includes the ones before it):

| Role | Can |
| --- | --- |
| viewer | Browse and preview. No printing (history won't record) and no changes; edit buttons are hidden. |
| printer | Print (records history), stock runs, quick print. |
| editor | Templates, labels, data, pictures, imports. |
| admin | Everything, including API tokens and deleting history. |

`GET /api/me` shows what the app sees (`{ enabled, signedIn, user, email,
name, groups, role, display }`); Settings > You shows it too. Example for
Pangolin with two Pangolin roles:

```yaml
environment:
  LABEBAL_AUTH_HEADERS: "true"
  LABEBAL_ROLE_ADMIN: "Admin"
  LABEBAL_ROLE_PRINTER: "Member"
```

Printing itself happens in the browser over Bluetooth, so roles can't stop a
determined user from printing; they control what the server accepts (saves,
history, tokens) and what the UI offers.

### Install as an app, offline printing

Chrome / Edge (desktop and Android) offer **Install** for labebal (HTTPS
required). The installed app caches the app shell, fonts, icons and the label
library, so a phone can keep printing labels it has seen while offline
(Bluetooth is local). Print history made offline is kept in the browser and
sent when the connection is back (the header shows "Offline · N prints to
record"). Changes to templates and labels need a connection. On phones use
**Quick print** (`/quick`): pick a label, stock run or recent print, set
copies, connect, print.

**Boards** (`/boards` in the menu; editors set them up): a saved set of labels, each at
its own size and quantity. Open a board (its link, `/boards/<id>`, can be
bookmarked on the packing station) and tap a label: it prints straight away on the
connected printer that takes that size, preferring one already set up for it. Taps
while a printer is busy wait their turn. Editors add labels one by one or a whole folder.

### Optional: Pocket ID

Configure Pocket ID as an OIDC identity provider in Pangolin
(Server Admin → Identity Providers → OIDC: issuer `https://id.example.com`,
client id / secret from a Pocket ID OIDC client whose callback URL is the one
Pangolin shows). Then restrict the labebal resource to those users. Passkeys
from Pocket ID work fine on the same Chrome profile used for printing.

## GitHub (pack sharing)

Settings > Packs > GitHub lets people connect GitHub, publish their packs to a
repo and follow other people's pack repos (user guide: [packs](PACKS.md)).
**Connect GitHub** uses the labebal GitHub App
([github.com/apps/labebal](https://github.com/apps/labebal)) through GitHub's
device flow: the app shows a code, the person types it on github.com. No
client secret, no callback URL and no inbound connection are needed, so it
works on any self-hosted install out of the box. **Use a token instead**
(fine-grained personal access token) always works too.

| Variable | Default | |
| --- | --- | --- |
| `LABEBAL_GITHUB_CLIENT_ID` | the labebal App (`Iv23licwijxvaX2N90lh`, in `packages/app/src/features/github/app-config.ts`) | Client id of the GitHub App used by Connect GitHub. Empty string hides the button (tokens only). |
| `LABEBAL_GITHUB_APP_SLUG` | `labebal` | The App's URL name, for the "Choose repositories" links (`https://github.com/apps/<slug>/installations/new`). |
| `LABEBAL_PACK_CHECK_MINUTES` | `10` | Pack sources older than this are re-checked when an admin's browser asks for update prompts (it asks at most every 5 minutes, on focus / navigation). GitHub sources read with an account first ask for the commit SHA with an ETag, so an unchanged repo costs one 304 answer. |
| `LABEBAL_GITHUB_API_URL` / `LABEBAL_GITHUB_URL` | `https://api.github.com` / `https://github.com` | **Tests and development only**: point GitHub calls at a fake server (`packages/app/src/test/mock-github.ts`). Ignored in production builds (`NODE_ENV=production`), so tokens only ever go to GitHub. |

Who can do what: anyone signed in can connect / disconnect **their own**
accounts (kept per user when identity headers are on; one shared set for the
instance when they are off). Publishing needs **editor**; adding sources and
applying updates need **admin**. Viewers see nothing new.

Tokens stay on the server (never sent to the browser or logged) and go only to
`api.github.com`, `github.com` and `raw.githubusercontent.com` over HTTPS.
Backups include them (`label_github_accounts`, like webhook secrets and
pasted source tokens), so keep backups private. A token GitHub stops accepting
(revoked) marks the account "needs reconnecting".

### Registering your own GitHub App (optional)

Only needed if you don't want to use the labebal App. On GitHub: Settings >
Developer settings > GitHub Apps > New GitHub App:

- **Homepage URL**: anything (e.g. your labebal URL).
- **Callback URL**: leave empty. **Request user authorization (OAuth) during installation**: off.
- **Enable Device Flow**: **on**.
- **Expire user authorization tokens**: **off** (labebal doesn't refresh tokens and has no client secret).
- **Webhook**: **Active off** (no webhook URL or secret).
- **Repository permissions**: **Contents: Read and write**, **Metadata: Read-only** (mandatory), **Administration: Read and write** (only for "Create a repo for my packs"; without it labebal sends people to a prefilled github.com/new page instead).
- No organization or account permissions, no events.
- **Where can this GitHub App be installed?**: Any account (so friends can use it too).

Then set `LABEBAL_GITHUB_CLIENT_ID` to its client id and
`LABEBAL_GITHUB_APP_SLUG` to its URL name. Don't generate a client secret or
private key: nothing uses them.

The App only sees repositories it is installed on. People pick them on the
App's install page ("Only select repositories" is fine); the app links there
as "Choose repositories" when it can't see any, and after creating a repo that
the installation doesn't cover yet.

## Printers

| Printer | How it connects | Where it works |
| --- | --- | --- |
| Niimbot N1 / B18, M2 | Bluetooth (or USB) from the browser | Chrome / Edge on a computer or Android |
| Brother P-touch PT-D610BT | Its Bluetooth serial port, from the browser (**Connect printer** > P-touch; on Windows pick "Standard Serial over Bluetooth link") | Chrome / Edge on a computer |
| Zebra and other ZPL printers | Over the network, **through the server** (raw printing, port 9100) | Any browser, phones included |

Every kind of printer is under the one **Connect printer** menu (a **+** once one is
connected, to add another). Network printers are added by an admin in Settings > Network printers (IP address, then
Detect: the printer reports its resolution and head width). The labebal server opens the
connection, so the container must be able to reach the printer's address. With Docker's
default bridge network that works for printers on the host's LAN; check with Detect.
Only printers saved there are ever contacted.

Each printer and each stock is marked **direct thermal** (no ribbon, heat-sensitive stock)
or **thermal transfer** (ribbon). The toolbar shows DT / TT and asks before printing stock
that needs a ribbon on a printer without one. Teams add their own stock and ribbons in
Settings > Stock and ribbons.

## Backups

### Built in (no downtime)

**Settings > Backup** downloads one zip with everything: templates and their
versions, labels, datasets (+ rows), stock runs, print history, uploaded
images / fonts / icons, tokens, and any other `label_*` table (counters,
settings, connected GitHub accounts **with their tokens**...). The same page restores a zip: **Replace** wipes labebal and
loads the backup, **Merge** only adds what is missing. A backup taken by a
newer labebal restores with a warning (columns this version lacks are skipped).

While the server runs it also writes **scheduled backups** to the data volume:

| Variable | Default | |
| --- | --- | --- |
| `LABEBAL_BACKUP_INTERVAL_HOURS` | `24` in production, `0` (off) in `next dev` | Hours between backups; `0` turns them off. The first one is written ~30 s after start when the newest is older than the interval. |
| `LABEBAL_BACKUP_DIR` | `/data/backups` (next to `LABEBAL_DATA_DIR`) | Where they go (`labebal-backup-<UTC time>.zip`). |
| `LABEBAL_BACKUP_KEEP` | `14` | How many to keep; older ones are deleted. |

Stored backups are listed in Settings > Backup (download / restore). Copy
`/data/backups` off the machine now and then (e.g. `docker cp` or a host
backup job): a backup on the same disk doesn't survive the disk.

```sh
curl -o labebal.zip https://labels.example.com/api/backup          # through the proxy
docker cp labebal:/data/backups ./labebal-backups                   # the scheduled ones
```

### Whole volume

Everything lives in the `/data` volume (`labebal-data` in compose). PGlite is a
single-process database: stop the container for a consistent copy.

```sh
docker compose stop labebal
docker run --rm -v labebal_labebal-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/labebal-data-$(date +%F).tgz -C /data .
docker compose start labebal
```

Restore: stop, `tar xzf` the archive back into an empty volume, start.

With `DATABASE_URL` (real Postgres), the built-in backups work the same
(set `LABEBAL_BACKUP_DIR` to a mounted volume); `pg_dump` works as usual too.

## Updating

```sh
git pull && docker compose up -d --build
```

Migrations run automatically on start; seeds only add missing templates and
never overwrite your edits.

### Host settings file (Pangolin override)

`compose.pangolin.yaml` loads `labebal.env` next to it (not in git) for
host-specific settings such as the sign-in roles above and
`LABEBAL_PUBLIC_URL`. Example for Pangolin + Pocket ID, where Pangolin sends
the user's org role in `Remote-Role`:

```
LABEBAL_AUTH_HEADERS=true
LABEBAL_ROLE_ADMIN=Admin,Owner
LABEBAL_DEFAULT_ROLE=printer
LABEBAL_ANONYMOUS_ROLE=printer
```

Open `/api/me` after signing in to see the identity and role labebal sees.

# Template text reference

Anywhere a template takes text (text elements, picture addresses, icon names,
QR / barcode values) you can use placeholders in double braces.

## Fields

`{{title}}` is replaced with the label's value for the field `title`. Fields are
defined per template (Template editor > Fields) and filled in per label (Print
page, or from a dataset on the Data page).

## Automatic values (tokens)

| Token | Gives |
| --- | --- |
| `{{date}}` | Today, `2026-11-19` |
| `{{date:DD MMM YYYY}}` | Custom format (see below) |
| `{{date+30d}}` / `{{date+30d:DD/MM/YY}}` | Date maths: `+` / `-` a number of `d` days, `w` weeks, `m` months, `y` years (`h` hours); combine them: `{{date+1y-1d}}`. Month steps keep the day, clamped to the month's end (31 Jan + 1m = 28 Feb). |
| `{{time}}` / `{{time+2h}}` | Current time, `14:05` (also `{{time:HH:mm:ss}}`) |
| `{{seq}}` / `{{seq:000}}` | Running number per printed copy, optionally zero-padded (`007`). Starts at 1, or at the "Start #" typed when printing, or comes from a persistent counter (see below). |
| `{{copy}}` / `{{copies}}` | Copy number in this print job, and total copies |
| `{{counter:box}}` / `{{counter:box:0000}}` | Next number of the persistent counter `box` (see Counters). The optional format overrides the counter's own. |
| `{{labelUrl}}` | Link to this label's page, `https://<your labebal>/l/<label id>`. Put it in a QR code and a phone camera opens the label's record: preview, values (links tappable), the data row it came from, notes, when it was last printed, Print again / Edit. The address comes from `LABEBAL_PUBLIC_URL` (see DEPLOY.md), else the address the app is open on. In template previews with example values it points at `/l/example`. |
| `{{recordUrl}}` | The template's **Record link** (Template tab), filled with this label's values. Empty when the template has none. |

Date formats: `YYYY` `YY`, `MMMM` (January) `MMM` (Jan) `MM` `M`, `DD` `D`,
`DDD` (day of the year, `001`-`366`, for Julian lot codes such as `{{date:YYDDD}}`),
`dddd` (Monday) `ddd` (Mon), `WW` (ISO week), `HH` `mm` `ss`. Put other text in
square brackets: `{{date:[Week] WW}}`.

Labels that use `{{seq}}`, `{{copy}}` or `{{counter:…}}` are drawn once per
copy, so every sticker gets its own number.

### Label pages and record links

Every label has a page at `/l/<label id>`. A QR code of `{{labelUrl}}` (Insert field >
Links) opens it from a phone: everyone can look; printers get **Print again**, editors
**Edit** and can write notes. Scanning such a QR with labebal's own Scan button opens the
page too.

Template tab > **Record link** is an optional address of each item in another system, written
with fields: `https://inventory.example/parts/{{sku|url}}`. When set, the label page shows a big
**Open in inventory** button, and `{{recordUrl}}` prints it. Use `|url` on values that may contain
spaces or slashes. This is how labels link into an inventory or order system.

## Counters (numbers that persist between prints)

A counter keeps counting from print to print, on every computer: box numbers,
batch numbers, serials. Manage them in **Settings > Counters**; a counter used
in a template (`{{counter:box}}`) is created automatically on its first print
(one shared sequence, never resets, starts at 1).

| Setting | Options |
| --- | --- |
| Counts | One shared sequence; one per template; one per value of a field (e.g. per `sku`: every SKU has its own 1, 2, 3...) |
| Starts again | Never; every day / ISO week / month / year (server clock); when a field's value changes (e.g. a new `lot` restarts the box count) |
| Start at | First number (default 1) |
| Format | `0000` pads to 4 digits; `#` runs mark the number inside text: `B-###` gives `B-007`. `{{counter:box:000}}` overrides it in one place. |

When you print, the numbers are reserved on the server in one go, so two
printers (or the API, `POST /api/v1/counters`) never get the same number. If a
print fails after reserving, those numbers are skipped, not reused. The print
history records which numbers each print used.

To number `{{seq}}` from a counter instead of 1, pick it under **Template
editor > Fields > "{{seq}} numbers from"**. A "Start #" typed when printing
still overrides it for that print.

## Ask when printing

Turn on **Ask when printing** for a field (Template editor > Fields) to fill it
in each time you print, e.g. a lot number, packing date or best-before date.
Print now, Print all (queue) and runs then show a short form first, once per
template; the answers go on the labels for that print only (they are not saved
to the labels) and are kept in the print history.

Options: the question shown, help text, the answer type (text, number or date)
and whether it is required. For dates the default value may be `today` or an
offset such as `+30d`; date answers arrive as `2026-11-19`, so format or shift
them with the `date` filter: `BB {{packed|date:+30d:DD MMM YYYY}}`.

## Filters (computed fields)

Add `|filter` after any field or token; chain as many as you like, left to right.

| Filter | Example | Result |
| --- | --- | --- |
| `upper` / `lower` | `{{name\|upper}}` | `M3 HEX NUT` |
| `title` | `{{name\|title}}` | `M3 Hex Nut` |
| `trim` | `{{name\|trim}}` | removes surrounding spaces |
| `pad:N` | `{{sku\|pad:5}}` | `00042` |
| `truncate:N` | `{{name\|truncate:8}}` | `M3 hex …` |
| `default:text` | `{{note\|default:n/a}}` | `n/a` when empty |
| `prefix:text` / `suffix:text` | `{{volts\|suffix: V}}` | `5 V` (nothing when empty) |
| `replace:from:to` | `{{name\|replace: :_}}` | `M3_hex_nut` |
| `slice:a:b` | `{{gtin\|slice:1:-1}}` | characters `a` up to (not including) `b`; negatives count from the end, either may be left out (`slice:-4` = last 4) |
| `date:FORMAT` | `{{packed\|date:DD MMM YYYY}}` | reformats a date value (`2026-11-19`, `20261119`, GS1 `261119`, or day first `19/11/2026`, `19.11.26`) |
| `date:+30d` / `date:+30d:FORMAT` | `{{packed\|date:+6m:MM/YY}}` | shifts it first (same offsets as `{{date+30d}}`) |
| `mod10` | `{{card\|mod10}}` | appends a Luhn check digit: `7992739871` -> `79927398713` |
| `gs1` | `{{gtin\|gs1}}` | appends a GS1 check digit (EAN-8/13, UPC-A, GTIN-14, SSCC): `400638133393` -> `4006381333931` |
| `add:N` | `{{box\|add:1}}` | adds to a whole number, keeping zero padding: `0099` -> `0100` |
| `url` | `{{sku\|url}}` | percent-encodes for use inside a link: `M3 × 8/A2` -> `M3%20%C3%97%208%2FA2` |

Check digits use the digits of the value only (spaces or dashes are ignored
in the sum but kept in the text; clean them first with `replace` if needed).

Example: `SKU-{{sku|pad:5}}` or `#{{seq:000}}` or `{{category|upper|default:MISC}}`.

Expiry / best-before examples:

| Text | Gives (printed 19 Nov 2026) |
| --- | --- |
| `BEST BEFORE {{date+30d:DD MMM YYYY\|upper}}` | `BEST BEFORE 19 DEC 2026` |
| `USE BY {{packed\|date:+3d:DD/MM}}` (packed asked at print) | `USE BY 22/11` |
| `LOT {{date:YYDDD}}-{{counter:lot:000}}` | `LOT 26323-004` |
| GS1 code value `(01){{gtin\|gs1}}(17){{date+1y:YYMMDD}}(10){{lot}}` | `(01)04006381333931(17)271119(10)A12` |

## Icons

An icon element (or an icon field such as `{{icon}}`) takes an icon id:

| Id | Library |
| --- | --- |
| `nut`, `tabler:nut` | [Tabler](https://tabler.io/icons) (default; plain names are Tabler). "Filled version" uses its solid variant. |
| `mdi:screw-machine-round-top` | [Material Design Icons](https://pictogrammers.com/library/mdi/): connectors, chips, resistors, screws (`mdi:screw-machine-round-top`), nuts, gamepads |
| `lucide:circuit-board` | [Lucide](https://lucide.dev/icons) |
| `game-icons:spring` | [Game Icons](https://game-icons.net) (CC BY 3.0: credit game-icons.net if you publish) |
| `simple-icons:raspberrypi` | [Simple Icons](https://simpleicons.org) brand logos (trademarks of their owners) |
| `custom:a-…` | Your own SVGs (Settings > Icons) |

All libraries are bundled (work offline). The icon picker searches all of them,
has quick-pick lists (Electronics, Connectors, Gaming, Hardware) and keeps
favourites and recent icons per browser. Data rules can set an icon field with
the same picker. Icons print as black shapes; white parts of an uploaded SVG
print as paper.

## Codes

A code element takes its value from its Contents (fields and tokens work). Kinds:

| Kind | Holds | Notes |
| --- | --- | --- |
| QR code | any text, web addresses | Error correction L / M / Q / H |
| Micro QR | up to 35 digits or 21 letters | Smaller than QR for short values (L / M / Q) |
| Rectangular Micro QR (rMQR) | short text | Long and thin: the best 2D code for 12 mm tall labels. The shape (7-17 rows) is picked to give the biggest dots for the box (M / H) |
| Data Matrix, Aztec | any text | |
| PDF417 | any text | Stacked barcode; the column count is picked to fit the box |
| Code 128 / Code 39 / Code 93 | letters and digits (39 / 93: capitals A-Z, digits, `- . $ / + %` and space) | |
| EAN-13 / EAN-8 / UPC-A / ITF-14 | 12 / 7 / 11 / 13 digits | The check digit is added; if you type it, it must be right |
| GS1-128 / GS1 Data Matrix | GS1 data with the application identifiers in brackets: `(01)09521234543213(10)LOT42` | |

Every bar and square is a whole number of printer dots; "Blank margin (quiet
zone)" keeps the standard empty border (QR 4 modules, Micro QR / rMQR / PDF417
2, Data Matrix 1, barcodes 7-11). Values a kind can't hold are explained under
Contents in the editor and listed by preflight.

## Preflight

Before printing, every label is checked at the chosen size: a warning badge on
print queue rows, a list under the label preview, a bar under the template
editor canvas (click a line to select the element) and an icon on the layer.
It flags text too small to read (capital letters under 7 dots) or shrunk a
lot, text that doesn't fit its box, barcode bars / squares only 1 dot wide,
codes without blank space around them or printed light-on-dark, values a code
can't hold, anything outside the printable area (the N1 prints only the middle
12 mm of 14 mm tape), empty fields that leave an element blank, and heavy
solid printing on inverted labels.

## Cable flags and wraps

Starters: **Cable flag**, **AV cable flag** (made for 14 x 75 mm) and
**Cable wrap (repeated text)**. Any group can be set up for cable flags
(Element > Cable flag):

- **Wrap zone for a cable of N mm**: the group becomes as long as the cable's
  circumference (π × N + 0.5 mm) and stays blank, so the strip goes once
  around the cable.
- **Copy of another group**: shows a live copy of that group (its own contents
  are ignored). *Back to back* flips positions left-right so the two halves
  line up when folded around the cable (letters are not mirrored); *Upside
  down* turns it 180° for flags that hang from a cable; *Same again* repeats
  it (wrap labels repeat their text so it shows from every side).

## Text styles and components (library parts)

**Text styles** are named looks for text kept in the library: font, size,
smallest size, fit, weight, letter spacing, line height, alignment, capitals,
colour and outline. Pick one under **Element > Text > Text style** (or "New
style from this text"). Changing a style (Templates page > Text styles > Edit)
changes every text using it, in every template. A setting you change on one
text wins over its style (shown as "Changed on this text", with **Use the
style** and **Update "style"** to push the change to the style). Variants and
per-label overrides still win over styles. Deleting a style keeps every text
looking the same, without the style.

**Components** are pieces designed once and placed in any template, e.g. the
brand logo lockup. Select something in the editor and click the
component button in Layers (**Make component**); it is saved in the library
and replaced by an *instance*. Place more from **Layers > Add > Components**.
Double-click an instance (or **Edit component**) to edit the component itself:
every instance in every template follows. On one instance you can change the
texts / icons / codes inside it and hide parts of it (**This copy**), or
**Detach** it into a plain group. Fields such as `{{title}}` inside a component
are filled from the labels of the template it is placed in. Deleting a
component turns its instances into plain groups first.

Both are plain JSON, stored in the library (export, backup, shared template
files and packs carry them):

```json
{ "id": "style-heading", "name": "Heading", "font": "Roboto Condensed", "sizePt": 9, "weight": 700, "uppercase": true }
```

A text uses it with `"style": "style-heading"`; `"styleOverrides": ["sizePt"]`
lists the properties the text sets itself. A property a style leaves out means
the default (`font`, `sizePt`, `color` left out keep the text's own).

```json
{
  "id": "comp-logo", "name": "Brand logo", "design": { "w": 3, "h": 10 },
  "root": { "id": "r", "type": "frame", "layout": "row", "lockup": true, "w": { "kind": "hug" }, "h": { "kind": "fill" }, "children": [ ... ] }
}
```

`root.w` / `root.h` are the size new instances start with; the instance's own
size, position, anchors, rotation and visibility apply. An instance is a node:

```json
{ "id": "brand", "type": "component", "ref": "comp-logo", "w": { "kind": "hug" }, "h": { "kind": "fill" },
  "overrides": { "access": { "text": "GAMES" }, "bar": { "hidden": true } } }
```

`overrides` are keyed by the component's node ids (inside a nested instance:
`<nested instance id>/<node id>`). When laid out, the component's nodes get the
ids `<instance id>/<node id>`, which variant patches and label overrides may
target. A missing component, a component placed inside itself, or nesting
deeper than 8 lays out empty.

## Moving things between groups on the label

Drag an item onto another group to put it inside (a free group keeps it where
you drop it; a row / column shows where it will slot in). Inside a row or
column, hover over a group inside it for a moment to move into it; drag
outside the row / column to take the item out into the group around it. The
target is outlined with "Into <group>". Hold **Alt** to keep it in its group.
Not available while editing a variant; locked groups, mirrored copies and
component instances don't take items. One undo reverts the whole drag.

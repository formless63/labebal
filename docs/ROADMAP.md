# Roadmap

labebal is a general-purpose label designer and printer, used from the browser
by non-technical people.

## Working today

- **Designing**: reflowing templates (rows, columns, free groups, per-size
  variants, visibility rules), canvas editor with undo, text styles and reusable
  components, rich text, tables, shapes, images with dithering, icons, codes.
- **Printing**: Niimbot N1 / B18 and M2, Brother PT-D610BT, Zebra / ZPL network
  printers. Several printers at once, pause / resume, RFID roll detection,
  calibration, test pattern, print checks.
- **Data**: datasets, spreadsheets, live sources, rules, counters, print-time
  questions, print inbox, webhooks, scanner lookup, import API with tokens.
- **Library**: folders, packs (GitHub or any URL), version history, print
  history, backup and restore, proof sheets, mockups.
- **Running it**: one container with an embedded database (or Postgres), roles
  from a reverse proxy, installable PWA with offline printing, embeddable module.

## Planned

- Verify the newer print features (several printers, pause / resume, label type
  per stock) on more real printers.
- Size detection for N1 rolls: the N1 does not report label length, so barcodes
  are learned through "remember this roll".
- Publish `@labebal/core` and `@labebal/app` to npm, and a prebuilt image.
- More printer models.

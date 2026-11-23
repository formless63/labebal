# Niimbot M2: findings from the real printer

Measured on a new M2 (`M2_H`, firmware 1.50,
hardware 1.01, protocol v4) over its Windows Bluetooth serial port (COM7) with
`tools/ble-bridge` + `packages/core/scripts/printer-probe.ts`. Raw output:
[`m2-probe.json`](m2-probe.json). Compare [`N1-NOTES.md`](N1-NOTES.md).

- **Connection** works the same way as the N1 (paired in Windows -> "Standard
  Serial over Bluetooth link" COM port, niimbluelib defaults, print task `B1`).
- **Printhead is 576 dots** (48.8 mm at 300 dpi), not the 567 in niimbluelib's
  model table; labebal's `media.ts` now uses 576.
- **Protocol v4 capabilities** are reported: darkness 1-5, speed 1-5, label types
  gap / black / black mark / transparent, max print length 3600 dots (~30 cm),
  no cutter, RFID support, auto power-off 0-4.
- **RFID with paper info** (the N1 has no paper info): the starter roll reports
  `paperWidth` 50 mm, label pitch 396 dots (33 mm) with a 36-dot (3 mm) gap,
  i.e. 50 x 30 mm labels, 270 per roll, barcode `042225005`. labebal's
  `matchRoll` picks `m2-50x30` from this automatically.
- **Ribbon tag**: total 2880, 18 used on a brand-new printer with 0 labels used
  (factory test prints), confirming ribbon units aren't labels.
- **Heartbeat** is richer than the N1's: lid closed, paper inserted, ribbon
  inserted, both RFID reads OK, battery 100 %, head temperature 69. The lid
  flag is reported correctly (only the N1 reverses it).
- Settings reported: connection sound on, power sound off, auto power-off = 3.
- **First print (test pattern, darkness 3, gap labels):** succeeded from the
  desktop (`packages/core/scripts/print-test.ts --com COM7`). The tags updated
  immediately: roll 0 -> 1 of 270, ribbon 18 -> 20 of 2880, so the ribbon uses
  about 2 units per 30 mm label (roughly 1,400 such labels per ribbon).
  Rendered pattern: [`m2-test-pattern.png`](m2-test-pattern.png).
- **Alignment:** on 50 x 30 mm gap labels the print sits about 0.5 mm high.
  Moving it 6 dots down (`--down 6`, leading edge padded) centres it; the
  one-dot outer frame lines top and bottom then sit on the die-cut edge, which
  is expected. Offered as the starting point for M2 printers (`MODEL_CALIBRATION_HINTS` in `media.ts`).

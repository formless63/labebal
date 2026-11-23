# Niimbot N1: findings from the real printer

Measured on an N1 (firmware 4.08/10.32, hardware
4.01/10.25, protocol v1) over its Windows Bluetooth serial port (COM3) with
`tools/ble-bridge` + `packages/core/scripts/printer-probe.ts`. Raw output:
[`n1-probe.json`](n1-probe.json).

- **Connection.** Paired in Windows, the N1 gets a "Standard Serial over
  Bluetooth link" COM port; niimbluelib works over it with default timings
  (print task `B1`). Each open/close plays the connect/disconnect chime.
  "The semaphore timeout period has expired" = printer off/asleep/busy.
- **Printhead info** isn't reported ("Feature not supported"); niimbluelib's
  model table (96 dots, 203 dpi, 12 mm) is used instead.
- **RFID: the roll and the ribbon each carry a tag** with total / used counts,
  written back by the printer as it prints, so usage travels with the roll.
  - Laser gold 14x30 roll: barcode `08062224`, 228 labels, type 1 (gap).
  - Ribbon: barcode `6977388397043`, total 1600. Its "used" is **not in labels**
    (83 after ~17 labels across two rolls), so labebal shows it as a percentage.
  - The N1 does not report label length (no paper info), so size is matched by
    barcode (`KNOWN_ROLLS` in `media.ts`) or learned via "remember this roll".
- **Lid flag is reversed** in the N1 heartbeat (shut -> `lidClosed: false`);
  corrected via `LID_FLAG_INVERTED` in `printer.ts`. With the lid open the
  tags can't be read (both report not present).
- Settings reported: connection sound on, power sound off, auto power-off = 3.

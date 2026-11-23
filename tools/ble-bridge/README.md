# Desktop printer bridge (Windows)

Drive a Niimbot printer from this PC without a browser and without native Node
modules (Smart App Control blocks unsigned binaries): `bridge.ps1` runs in
Windows PowerShell 5.1 and talks to the printer through Windows' own APIs, and
`packages/core/scripts/printer-probe.ts` runs niimbluelib on top of it.

```powershell
# what's around (Bluetooth LE advertisements)
powershell -NoProfile -ExecutionPolicy Bypass -File tools\ble-bridge\bridge.ps1 -Scan -Seconds 15

# read everything the printer reports (classic Bluetooth serial port / USB)
pnpm --filter @labebal/core printer-probe -- --com COM3 --json probe.json

# ... or over Bluetooth LE by advertised name / address
pnpm --filter @labebal/core printer-probe -- --name N1
pnpm --filter @labebal/core printer-probe -- --address AABBCCDDEEFF
```

- A printer paired in Windows Bluetooth settings gets a "Standard Serial over
  Bluetooth link (COMx)" port; find it with
  `Get-PnpDevice -Class Ports | ? FriendlyName -like '*Bluetooth*'` and match the
  printer's address in the instance id.
- "The semaphore timeout period has expired" on a COM port means Windows
  couldn't reach the printer: it's off/asleep, out of range, or connected to
  something else (phone app, another browser tab).
- Line protocol (stdin/stdout): `TX <hex>` in; `READY ...`, `RX <hex>`, `LOG ...`,
  `ERR ...` out. `LabebalBle.cs` is compiled in memory (CodeDom) and reaches
  WinRT Bluetooth LE via reflection.

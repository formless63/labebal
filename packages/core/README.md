# @labebal/core

The label engine behind [labebal](https://github.com/formless63/labebal):
document schema, reflow layout, 1-bit renderer, barcodes, packs, importers and
printer drivers (Niimbot, Brother P-touch, ZPL). No React, no database.

```sh
npm install @labebal/core
```

```ts
import { loadCodeEncoder, loadFonts, labelPixels, printerFor, renderLabel, sizeById } from "@labebal/core";

await Promise.all([loadFonts(), loadCodeEncoder()]);
const size = sizeById("n1-14x30")!;
const { canvas } = renderLabel(template, { values: { title: "Snacks" } }, {
  ...labelPixels(size, printerFor(size.printer)),
  marginMm: 0.5,
  invert: false,
});
```

Docs: https://formless63.github.io/labebal/

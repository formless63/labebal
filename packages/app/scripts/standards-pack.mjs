#!/usr/bin/env node
/**
 * Writes the built-in "Standard formats" pack (packs/standards): templates
 * laid out after common label standards, one sample label each.
 *
 *   node scripts/standards-pack.mjs
 *
 * The layouts follow each standard's published structure (signal-word
 * panels, GS1 application identifiers, ECIA data identifiers...). Several of
 * the standards (ANSI Z535, TIA-606, NFPA) are paid documents: check labels
 * that must comply against your copy. Pictograms are drawn from the bundled
 * icon sets (stand-ins, not the official artwork).
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../packs/standards");
const FOLDER = "Standard formats";
// Bundled label fonts (variable weight): regular weights print as hairlines at 203 dpi, so text is 600+.
const FONT = "Atkinson Hyperlegible Next";
const MONO = "JetBrains Mono";

/* ---------------------------------------------------------------- helpers */

const fill = (weight) => (weight ? { kind: "fill", weight } : { kind: "fill" });
const fixed = (mm) => ({ kind: "fixed", mm });
const pct = (p) => ({ kind: "pct", pct: p });
const hug = { kind: "hug" };
const pad = (v, h = v) => [v, h, v, h];

function text(id, value, o = {}) {
  return {
    id,
    name: o.name ?? id,
    type: "text",
    text: value,
    font: o.mono ? MONO : FONT,
    weight: o.bold ? 800 : (o.weight ?? 600),
    sizePt: o.pt ?? 10,
    minSizePt: o.min ?? 3.5,
    fit: o.fit ?? "shrink",
    align: o.align ?? "left",
    valign: o.valign ?? "middle",
    ...(o.upper ? { uppercase: true } : {}),
    ...(o.spacing ? { letterSpacing: o.spacing } : {}),
    ...(o.lineHeight ? { lineHeight: o.lineHeight } : {}),
    color: o.color ?? "black",
    w: o.w ?? fill(),
    h: o.h ?? fill(o.hw),
    ...(o.extra ?? {}),
  };
}
const caption = (id, value, o = {}) => text(id, value, { pt: 5, min: 3, bold: true, upper: true, spacing: 0.15, ...o });

function frame(layout, id, children, o = {}) {
  return {
    id,
    name: o.name ?? id,
    type: "frame",
    layout,
    w: o.w ?? fill(o.ww),
    h: o.h ?? fill(o.hw),
    ...(o.padding ? { padding: o.padding } : {}),
    ...(o.gap ? { gap: o.gap } : {}),
    align: o.align ?? "stretch",
    ...(o.justify ? { justify: o.justify } : {}),
    ...(o.fill ? { fill: o.fill } : {}),
    ...(o.stroke ? { stroke: o.stroke, strokeMm: o.strokeMm ?? 0.4 } : {}),
    ...(o.radius ? { radius: o.radius } : {}),
    ...(o.extra ?? {}),
    children,
  };
}
const row = (id, children, o) => frame("row", id, children, o);
const col = (id, children, o) => frame("column", id, children, o);
const free = (id, children, o) => frame("free", id, children, o);

const icon = (id, value, o = {}) => ({ id, name: o.name ?? id, type: "icon", icon: value, ...(o.filled ? { filled: true } : {}), color: o.color ?? "black", w: o.w ?? hug, h: o.h ?? fill(), ...(o.extra ?? {}) });
const line = (id, direction = "horizontal", o = {}) => ({
  id,
  name: o.name ?? id,
  type: "line",
  direction,
  color: "black",
  strokeMm: o.strokeMm ?? 0.4,
  w: direction === "horizontal" ? fill() : fixed(o.strokeMm ?? 0.4),
  h: direction === "horizontal" ? fixed(o.strokeMm ?? 0.4) : fill(),
});
const code = (id, format, value, o = {}) => ({
  id,
  name: o.name ?? id,
  type: "code",
  format,
  value,
  ...(o.showText ? { showText: true } : {}),
  ...(o.ecc ? { ecc: o.ecc } : {}),
  quietZone: o.quiet ?? true,
  color: "black",
  w: o.w ?? fill(),
  h: o.h ?? fill(o.hw),
});
const field = (key, label, def, o = {}) => ({ key, label, type: o.multiline ? "multiline" : "text", default: def, ...(o.help ? { help: o.help } : {}), ...(o.ask ?? {}) });

let ruleN = 0;
const rule = (name, when, then) => ({ id: `r${++ruleN}`, name, when, then });
const empty = (column) => ({ column, op: "isEmpty" });
const hideWhenEmpty = (column, ...nodes) => rule(`Hide ${nodes.join(", ")} when ${column} is empty`, empty(column), { overrides: Object.fromEntries(nodes.map((n) => [n, { hidden: true }])) });

function template(id, name, description, design, fields, root, o = {}) {
  return {
    id,
    name,
    description,
    schema: 2,
    design,
    scaleText: true,
    tags: ["standard", ...(o.tags ?? [])],
    fields,
    root: { ...root, id: "root", name: "Label" },
    ...(o.rules?.length ? { rules: { mode: "all", rules: o.rules } } : {}),
  };
}

/** Caption over a value (form-style box). */
const cell = (id, cap, value, o = {}) =>
  col(id, [caption(`${id}Cap`, cap), text(`${id}Val`, value, { bold: true, pt: o.pt ?? 10, mono: o.mono, hw: 2 })], { padding: pad(0.6, 1), gap: 0.2, ...o.frame });

/** Signal-word panel (ANSI Z535 / NFPA 70E): black band, white safety alert symbol and word. */
const signalPanel = (id, value, o = {}) =>
  row(id, [icon(`${id}Alert`, "alert-triangle", { filled: true, color: "white", name: "Safety alert symbol" }), text(`${id}Word`, value, { bold: true, upper: true, pt: o.pt ?? 22, color: "white", w: hug, spacing: 0.1, name: "Signal word" })], {
    h: o.h ?? fill(o.hw ?? 1),
    fill: "black",
    padding: pad(0.8, 2),
    gap: 1.5,
    justify: "center",
    name: "Signal word panel",
  });

const templates = [];
const labels = [];
const label = (id, templateId, name, values, sub) => labels.push({ id, templateId, name, values, tags: ["standard", `folder:${FOLDER}/${sub}`] });

/* ------------------------------------------------- GS1 logistic label (SSCC) */

templates.push(
  template(
    "t-std-gs1-logistic",
    "GS1 logistic label (SSCC)",
    "Pallet / carton shipping label after the GS1 Logistic Label guideline: from and to, SSCC, content GTIN, count, batch and best-before, with GS1-128 barcodes. 4 x 6 in. Sender comes from Team values (company, address).",
    { w: 101.6, h: 152.4 },
    [
      field("to", "Ship to", "Customer name\n1 Delivery Road\nTown, ST 12345", { multiline: true }),
      field("sscc", "SSCC (17 digits)", "00012345600000001", { help: "Extension digit, GS1 company prefix and serial; the check digit is added. Use a counter: {{counter:sscc:00012345600000000}}." }),
      field("gtin", "Content GTIN (13 digits)", "0952123454321", { help: "The trade item inside; the check digit is added." }),
      field("count", "Count", "24"),
      field("batch", "Batch / lot", "LOT42"),
      field("bestBefore", "Best before", "2027-06-30", { help: "A date (any format); printed as YYMMDD in the barcode." }),
    ],
    col(
      "root",
      [
        row(
          "addresses",
          [
            col("from", [caption("fromCap", "From"), text("fromText", "{{team:company|default:Your company}}\n{{team:address}}", { pt: 9, valign: "top", hw: 4, name: "Sender (team values)" })], { padding: pad(1.2, 1.5), gap: 0.5 }),
            line("addrSplit", "vertical"),
            col("toBox", [caption("toCap", "To"), text("toText", "{{to}}", { pt: 11, bold: true, valign: "top", hw: 4 })], { padding: pad(1.2, 1.5), gap: 0.5, ww: 1.3 }),
          ],
          { hw: 3 },
        ),
        line("l1"),
        col("ssccBox", [caption("ssccCap", "SSCC"), text("ssccVal", "{{sscc|gs1}}", { pt: 16, bold: true, mono: true, hw: 2 })], { padding: pad(1, 1.5), hw: 1.6 }),
        line("l2"),
        row("details1", [cell("content", "Content (GTIN)", "{{gtin|gs1}}", { mono: true, frame: { ww: 1.6 } }), line("d1Split", "vertical"), cell("countBox", "Count", "{{count}}")], { hw: 1.4 }),
        line("l3"),
        row("details2", [cell("batchBox", "Batch / lot", "{{batch}}", { mono: true, frame: { ww: 1.6 } }), line("d2Split", "vertical"), cell("bbBox", "Best before (dd.mm.yy)", "{{bestBefore|date:DD.MM.YY}}")], { hw: 1.4 }),
        line("l4"),
        col(
          "barcodes",
          [
            code("bc1", "gs1_128", "(02){{gtin|gs1}}(37){{count}}", { showText: true, name: "Content + count" }),
            code("bc2", "gs1_128", "(15){{bestBefore|date:YYMMDD}}(10){{batch}}", { showText: true, name: "Best before + batch" }),
            code("bc3", "gs1_128", "(00){{sscc|gs1}}", { showText: true, name: "SSCC" }),
          ],
          { padding: pad(1.5, 3), gap: 2, hw: 7 },
        ),
      ],
      { padding: pad(1.5), stroke: "black", strokeMm: 0.5 },
    ),
    {
      tags: ["shipping", "gs1"],
      rules: [
        rule("No batch: best-before only", empty("batch"), { overrides: { bc2: { value: "(15){{bestBefore|date:YYMMDD}}" }, batchBox: { hidden: true }, d2Split: { hidden: true } } }),
        rule("No best-before: batch only", empty("bestBefore"), { overrides: { bc2: { value: "(10){{batch}}" }, bbBox: { hidden: true }, d2Split: { hidden: true } } }),
      ],
    },
  ),
);
label("l-std-gs1-logistic", "t-std-gs1-logistic", "GS1 logistic label (sample)", {}, "Shipping");

/* ------------------------------------------------- ANSI Z535.4 safety label */

templates.push(
  template(
    "t-std-z535",
    "Safety label (ANSI Z535.4 style)",
    "Product safety label: signal-word panel (DANGER, WARNING, CAUTION, NOTICE), a symbol panel and the message. Follows the Z535.4 layout in black and white; NOTICE drops the safety alert symbol. Check compliance against the standard.",
    { w: 100, h: 50 },
    [
      field("signal", "Signal word", "WARNING", { help: "DANGER, WARNING, CAUTION or NOTICE." }),
      field("message", "Message", "Hot surface.\nContact may cause burns.\nAllow to cool before servicing.", { multiline: true, help: "What the hazard is, what happens, how to avoid it." }),
      field("symbol", "Symbol (icon)", "mdi:fire", { help: "Any icon id, e.g. mdi:fire, mdi:hand-back-right-off, mdi:lightning-bolt, mdi:safety-goggles. Empty: no symbol panel." }),
    ],
    col(
      "root",
      [
        signalPanel("signalPanel", "{{signal}}", { hw: 1 }),
        row(
          "body",
          [
            row("symbolBox", [icon("symbolIcon", "{{symbol}}", { w: fill(), name: "Symbol" })], { w: pct(30), stroke: "black", strokeMm: 0.5, padding: pad(1.5), justify: "center", name: "Symbol panel" }),
            text("message", "{{message}}", { pt: 11, bold: true, lineHeight: 1.15 }),
          ],
          { hw: 2.6, padding: pad(1.5, 1.5), gap: 2 },
        ),
      ],
      { stroke: "black", strokeMm: 0.6 },
    ),
    {
      tags: ["safety"],
      rules: [
        rule("NOTICE has no safety alert symbol", { column: "signal", op: "equals", value: "NOTICE" }, { overrides: { signalPanelAlert: { hidden: true } } }),
        hideWhenEmpty("symbol", "symbolBox"),
      ],
    },
  ),
);
label("l-std-z535-warning", "t-std-z535", "Safety: WARNING hot surface", {}, "Safety");
label("l-std-z535-notice", "t-std-z535", "Safety: NOTICE authorised staff", { signal: "NOTICE", message: "Authorised personnel only.\nKeep this door closed.", symbol: "" }, "Safety");

/* ------------------------------------------------- NFPA 70E arc flash label */

const afRow = (id, cap, value) => row(id, [caption(`${id}Cap`, cap, { pt: 6, w: pct(52) }), text(`${id}Val`, value, { bold: true, pt: 9 })], { padding: pad(0.3, 1.5), gap: 1 });

templates.push(
  template(
    "t-std-arc-flash",
    "Arc flash label (NFPA 70E)",
    "Equipment arc flash and shock label with the fields NFPA 70E 130.5(H) asks for: nominal voltage, arc flash boundary, incident energy and working distance or PPE category, shock approach boundaries, date of the study. 4 x 3 in.",
    { w: 101.6, h: 76.2 },
    [
      field("signal", "Signal word", "WARNING", { help: "WARNING, or DANGER above 40 cal/cm²." }),
      field("voltage", "Nominal voltage", "480 VAC"),
      field("boundary", "Arc flash boundary", "1.2 m (47 in)"),
      field("energy", "Incident energy", "8.0 cal/cm² at 455 mm (18 in)"),
      field("ppe", "PPE category / clothing", "Category 2 · arc rated 8 cal/cm²"),
      field("limited", "Limited approach", "1.07 m (3 ft 6 in)"),
      field("restricted", "Restricted approach", "0.3 m (1 ft)"),
      field("equipment", "Equipment", "MCC-2 · Bucket 3A"),
      field("studyDate", "Study date", "2026-11-21"),
    ],
    col(
      "root",
      [
        signalPanel("signalPanel", "{{signal}}", { hw: 1.4, pt: 20 }),
        text("hazard", "Arc flash and shock hazard\nAppropriate PPE required", { bold: true, upper: true, align: "center", pt: 9, hw: 1.3 }),
        line("l1"),
        col(
          "rows",
          [
            afRow("rVolt", "Shock hazard when cover is removed", "{{voltage}}"),
            afRow("rBoundary", "Arc flash boundary", "{{boundary}}"),
            afRow("rEnergy", "Incident energy at working distance", "{{energy}}"),
            afRow("rPpe", "PPE", "{{ppe}}"),
            afRow("rLimited", "Limited approach boundary", "{{limited}}"),
            afRow("rRestricted", "Restricted approach boundary", "{{restricted}}"),
          ],
          { hw: 6, padding: pad(0.5, 0) },
        ),
        line("l2"),
        row("footer", [text("equipment", "{{equipment}}", { pt: 6, bold: true }), text("study", "Study {{studyDate}} · {{team:company}}", { pt: 6, align: "right" })], { hw: 0.8, padding: pad(0.3, 1.5) }),
      ],
      { stroke: "black", strokeMm: 0.6 },
    ),
    { tags: ["safety", "electrical"], rules: [hideWhenEmpty("limited", "rLimited"), hideWhenEmpty("restricted", "rRestricted")] },
  ),
);
label("l-std-arc-flash", "t-std-arc-flash", "Arc flash: MCC-2 (sample)", {}, "Safety");

/* ------------------------------------------------- GHS / OSHA HazCom container */

/** GHS pictograms: word -> icon stand-in. */
const GHS = [
  ["flame", "Flammable", "mdi:fire"],
  ["oxidiser", "Oxidiser (flame over circle)", "mdi:fire-circle"],
  ["explosive", "Explosive (exploding bomb)", "game-icons:bright-explosion"],
  ["corrosive", "Corrosive", "game-icons:acid"],
  ["gas", "Gas under pressure", "mdi:gas-cylinder"],
  ["toxic", "Acute toxicity (skull)", "mdi:skull-crossbones"],
  ["irritant", "Irritant / harmful (exclamation)", "mdi:exclamation-thick"],
  ["health", "Health hazard", "game-icons:internal-organ"],
  ["environment", "Hazardous to the environment", "mdi:fish-off"],
];
const pictogram = (key, iconId, name) =>
  free(
    `ghs-${key}`,
    [
      { id: `ghs-${key}-frame`, name: "Diamond", type: "polygon", sides: 4, fill: "none", stroke: "black", strokeMm: 0.9, w: fill(), h: fill(), x: 0, y: 0, ax: "scale", ay: "scale" },
      icon(`ghs-${key}-icon`, iconId, { w: fixed(7), h: fixed(7), name, extra: { x: 4.5, y: 4.5, ax: "scale", ay: "scale" } }),
    ],
    { w: fixed(16), h: fixed(16), name: `Pictogram: ${name}` },
  );

templates.push(
  template(
    "t-std-ghs",
    "Chemical container (GHS / OSHA HazCom)",
    "Workplace / secondary container label with the GHS elements: product identifier, signal word, pictograms, hazard and precautionary statements, supplier. Pictograms are icon stand-ins drawn in black; containers shipped to others need the official red-bordered pictograms.",
    { w: 101.6, h: 76.2 },
    [
      field("product", "Product name", "Isopropyl alcohol 99%"),
      field("signal", "Signal word", "Danger", { help: "Danger or Warning." }),
      field("pictograms", "Pictograms", "flame, irritant", { help: `Comma separated: ${GHS.map((g) => g[0]).join(", ")}.` }),
      field("hazards", "Hazard statements", "Highly flammable liquid and vapour.\nCauses serious eye irritation.\nMay cause drowsiness or dizziness.", { multiline: true }),
      field("precautions", "Precautionary statements", "Keep away from heat, sparks and open flames. No smoking.\nWear eye protection. IF IN EYES: rinse cautiously with water for several minutes.", { multiline: true }),
      field("supplier", "Supplier", "", { help: "Name, address and phone of the supplier. Empty: your Team values (company, address, phone)." }),
    ],
    col(
      "root",
      [
        text("product", "{{product}}", { bold: true, pt: 16, hw: 1.6 }),
        row("hazardRow", [row("pictograms", GHS.map(([k, n, i]) => pictogram(k, i, n)), { w: hug, gap: 1, name: "Pictograms" }), text("signal", "{{signal}}", { bold: true, upper: true, pt: 20, align: "center" })], { hw: 2.6, gap: 2 }),
        text("hazards", "{{hazards}}", { pt: 8, bold: true, valign: "top", hw: 2.4, lineHeight: 1.1 }),
        text("precautions", "{{precautions}}", { pt: 7, valign: "top", hw: 2.4, lineHeight: 1.1 }),
        line("l1"),
        text("supplier", "{{supplier}}", { pt: 6, hw: 0.7 }),
      ],
      { padding: pad(2, 2.5), gap: 1, stroke: "black", strokeMm: 0.5 },
    ),
    {
      tags: ["safety", "chemical"],
      rules: [
        ...GHS.map(([k, n]) => rule(`Show ${n} only when listed`, { column: "pictograms", op: "contains", value: k, not: true }, { overrides: { [`ghs-${k}`]: { hidden: true } } })),
        rule("No supplier: use Team values", empty("supplier"), { overrides: { supplier: { text: "{{team:company}} · {{team:address}} · {{team:phone}}" } } }),
      ],
    },
  ),
);
label("l-std-ghs-ipa", "t-std-ghs", "GHS: isopropyl alcohol (sample)", {}, "Safety");

/* ------------------------------------------------- NFPA 704 diamond */

const q = (id, name, cx, cy, value, pt) => [
  { id: `${id}Frame`, name: `${name} diamond`, type: "polygon", sides: 4, fill: "none", stroke: "black", strokeMm: 0.8, w: fixed(25), h: fixed(25), x: cx - 12.5, y: cy - 12.5, ax: "scale", ay: "scale" },
  text(`${id}Val`, value, { bold: true, pt, align: "center", w: fixed(13), h: fixed(11), name, extra: { x: cx - 6.5, y: cy - 5.5, ax: "scale", ay: "scale" } }),
];

templates.push(
  template(
    "t-std-nfpa704",
    "NFPA 704 hazard diamond",
    "Fire diamond for storage areas and tanks: health (left), flammability (top), instability (right), 0-4 each, and special hazards (bottom: W, OX, SA). Drawn in outline; NFPA 704 colours the quadrants blue, red, yellow and white.",
    { w: 50, h: 50 },
    [
      field("health", "Health (0-4)", "2"),
      field("flammability", "Flammability (0-4)", "3"),
      field("instability", "Instability (0-4)", "0"),
      field("special", "Special", "", { help: "W (reacts with water), OX (oxidiser), SA (simple asphyxiant), or empty." }),
    ],
    free("root", [
      ...q("flam", "Flammability", 25, 12.5, "{{flammability}}", 28),
      ...q("health", "Health", 12.5, 25, "{{health}}", 28),
      ...q("inst", "Instability", 37.5, 25, "{{instability}}", 28),
      ...q("special", "Special", 25, 37.5, "{{special}}", 16),
    ]),
    { tags: ["safety", "chemical"], rules: [hideWhenEmpty("special", "specialVal")] },
  ),
);
label("l-std-nfpa704", "t-std-nfpa704", "NFPA 704: flammable store (sample)", {}, "Safety");

/* ------------------------------------------------- ANSI/TIA-606 cable ID */

templates.push(
  template(
    "t-std-tia606",
    "Cable / port ID (ANSI/TIA-606)",
    "Identifier for cables, patch panel ports and outlets in the TIA-606 style (space, rack, panel, port: 1A-AJ05-B:24), with the far end underneath. Use the same label at both ends.",
    { w: 40, h: 12 },
    [
      field("id", "Identifier", "1A-AJ05-B:24", { help: "TIA-606 identifier, e.g. telecom space 1A, rack AJ05, panel B, port 24." }),
      field("farEnd", "Far end", "2B-AA01-A:12", { help: "Where the other end lands. Empty: one line." }),
    ],
    col("root", [text("id", "{{id}}", { bold: true, mono: true, pt: 14, align: "center", hw: 2 }), text("farEnd", "→ {{farEnd}}", { mono: true, pt: 7, align: "center" })], { padding: pad(0.6, 1), gap: 0.3 }),
    { tags: ["cables", "network"], rules: [hideWhenEmpty("farEnd", "farEnd")] },
  ),
);
label("l-std-tia606", "t-std-tia606", "TIA-606: patch panel port (sample)", {}, "Cables");

/* ------------------------------------------------- ECIA EIGP 114 reel label */

const GS = "\u001d";
const eigpValue = `[)>\u001e06${GS}P{{custPart}}${GS}1P{{mfrPart}}${GS}K{{po}}${GS}Q{{qty}}${GS}10D{{dateCode}}${GS}1T{{lot}}${GS}4L{{coo}}\u001e\u0004`;
const eRow = (id, cap, value) => row(id, [caption(`${id}Cap`, cap, { pt: 5, w: pct(34) }), text(`${id}Val`, value, { bold: true, mono: true, pt: 8 })], { gap: 1 });

templates.push(
  template(
    "t-std-eigp114",
    "Component reel / bag (ECIA EIGP 114)",
    "Electronic component packaging label: readable part numbers, quantity, date code, lot and country of origin, and the ECIA 2D symbol (Data Matrix, ANSI MH10.8.2 format 06 with data identifiers P, 1P, K, Q, 10D, 1T, 4L). 4 x 2 in.",
    { w: 101.6, h: 50.8 },
    [
      field("custPart", "Customer part number (P)", "R-10K-0603"),
      field("mfrPart", "Manufacturer part number (1P)", "RC0603FR-0710KL"),
      field("po", "PO number (K)", "PO-1042"),
      field("qty", "Quantity (Q)", "5000"),
      field("dateCode", "Date code (10D, YYWW)", "2647"),
      field("lot", "Lot (1T)", "LOT42"),
      field("coo", "Country of origin (4L)", "TW", { help: "Two-letter country code." }),
      field("description", "Description", "Resistor 10 kΩ 1% 0603"),
    ],
    row(
      "root",
      [
        col(
          "readable",
          [
            text("desc", "{{description}}", { bold: true, pt: 9, hw: 1.3 }),
            eRow("rCust", "Cust P/N (P)", "{{custPart}}"),
            eRow("rMfr", "Mfr P/N (1P)", "{{mfrPart}}"),
            eRow("rPo", "PO (K)", "{{po}}"),
            eRow("rQty", "Qty (Q)", "{{qty}}"),
            eRow("rDate", "Date code (10D)", "{{dateCode}}"),
            eRow("rLot", "Lot (1T)", "{{lot}}"),
            eRow("rCoo", "Origin (4L)", "{{coo}}"),
          ],
          { ww: 2.2, gap: 0.2 },
        ),
        col("symbol", [code("dm", "datamatrix", eigpValue, { name: "ECIA 2D symbol" }), caption("mfr", "{{team:company}}", { align: "center", hw: 0.15 })], { ww: 1, gap: 0.5 }),
      ],
      { padding: pad(2, 2.5), gap: 2, stroke: "black", strokeMm: 0.4 },
    ),
    { tags: ["electronics", "parts"], rules: [hideWhenEmpty("po", "rPo")] },
  ),
);
label("l-std-eigp114", "t-std-eigp114", "EIGP 114: 10k resistor reel (sample)", {}, "Parts");

/* ------------------------------------------------- GS1 UDI */

templates.push(
  template(
    "t-std-udi",
    "Medical device UDI (GS1)",
    "Unique Device Identification label: GS1 Data Matrix with the device GTIN (01), expiry (17), lot (10) and serial (21), and the same data in readable text.",
    { w: 50, h: 25 },
    [
      field("gtin", "GTIN (13 digits)", "0952123454321", { help: "The check digit is added." }),
      field("expiry", "Use by", "2028-12-31", { help: "A date; printed as YYMMDD in the code." }),
      field("lot", "Lot", "A1234"),
      field("serial", "Serial", "", { help: "Empty: no (21) serial." }),
    ],
    row(
      "root",
      [
        code("dm", "gs1datamatrix", "(01){{gtin|gs1}}(17){{expiry|date:YYMMDD}}(10){{lot}}(21){{serial}}", { w: hug, name: "UDI Data Matrix" }),
        col(
          "hri",
          [
            text("hGtin", "(01) {{gtin|gs1}}", { mono: true, bold: true, pt: 7 }),
            text("hExp", "(17) {{expiry|date:YYMMDD}}", { mono: true, pt: 7 }),
            text("hLot", "(10) {{lot}}", { mono: true, pt: 7 }),
            text("hSerial", "(21) {{serial}}", { mono: true, pt: 7 }),
          ],
          { gap: 0.2 },
        ),
      ],
      { padding: pad(1.2, 1.5), gap: 1.5 },
    ),
    {
      tags: ["medical", "gs1"],
      rules: [rule("No serial", empty("serial"), { overrides: { hSerial: { hidden: true }, dm: { value: "(01){{gtin|gs1}}(17){{expiry|date:YYMMDD}}(10){{lot}}" } } })],
    },
  ),
);
label("l-std-udi", "t-std-udi", "UDI: catheter (sample)", {}, "Retail and GS1");

/* ------------------------------------------------- asset tag */

templates.push(
  template(
    "t-std-asset",
    "Asset tag",
    "Equipment / property tag: your company (Team values) on a black band, the asset number in large type and as a Code 128 barcode.",
    { w: 50, h: 25 },
    [field("asset", "Asset number", "A-000123", { help: "Use a counter for new tags: {{counter:asset:A-000000}}." })],
    col(
      "root",
      [
        row("band", [text("company", "Property of {{team:company|default:your company}}", { bold: true, upper: true, pt: 7, color: "white", align: "center", spacing: 0.1 })], { fill: "black", padding: pad(0.6, 1.5), hw: 1 }),
        text("number", "{{asset}}", { bold: true, mono: true, pt: 14, align: "center", hw: 1.5 }),
        code("barcode", "code128", "{{asset}}", { hw: 1.8, name: "Barcode" }),
        text("contact", "{{team:phone}}", { pt: 5, align: "center", hw: 0.5 }),
      ],
      { padding: pad(0, 0), gap: 0.4 },
    ),
    { tags: ["inventory"] },
  ),
);
label("l-std-asset", "t-std-asset", "Asset tag (sample)", {}, "Inventory");

/* ------------------------------------------------- shelf / price label */

templates.push(
  template(
    "t-std-shelf",
    "Shelf / price label (UPC)",
    "Retail shelf edge label: product, price, unit price and the UPC-A barcode.",
    { w: 60, h: 30 },
    [
      field("product", "Product", "Organic oat drink 1 L"),
      field("price", "Price", "$2.49"),
      field("unit", "Unit price", "$2.49 / L"),
      field("upc", "UPC-A (11 digits)", "03600029145", { help: "The check digit is added. EAN-13: change the barcode kind." }),
    ],
    col(
      "root",
      [
        text("product", "{{product}}", { bold: true, pt: 10, valign: "top", hw: 1.6 }),
        row("bottom", [code("upc", "upca", "{{upc}}", { showText: true, w: fixed(36), name: "UPC" }), col("prices", [text("price", "{{price}}", { bold: true, pt: 24, align: "right", hw: 3 }), text("unit", "{{unit}}", { pt: 9, min: 5, align: "right", hw: 1.2 })])], { hw: 3, gap: 1.5 }),
      ],
      { padding: pad(1.5, 2), gap: 1 },
    ),
    { tags: ["retail"] },
  ),
);
label("l-std-shelf", "t-std-shelf", "Shelf label (sample)", {}, "Retail and GS1");

/* ------------------------------------------------- write */

rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, "templates"), { recursive: true });
mkdirSync(path.join(out, "labels"), { recursive: true });
const files = [];
for (const t of templates) {
  const f = `templates/${t.id.replace(/^t-std-/, "")}.json`;
  writeFileSync(path.join(out, f), JSON.stringify(t, null, 2) + "\n");
  files.push(f);
}
writeFileSync(path.join(out, "labels/standards.json"), JSON.stringify(labels, null, 2) + "\n");
const manifest = {
  $schema: "https://raw.githubusercontent.com/formless63/labebal/main/packs/schema/labebal-pack.schema.json",
  id: "standards",
  name: "Standard formats",
  version: "1.1.0",
  description:
    "Templates laid out after common label standards: GS1 logistic (SSCC) and UDI, ANSI Z535 safety, NFPA 70E arc flash, GHS chemical container, NFPA 704 diamond, TIA-606 cable ID, ECIA EIGP 114 reel, asset tag, shelf price label. Uses Team values for your company details. Turn off in Settings > Packs.",
  author: "labebal",
  folder: FOLDER,
  templates: files,
  labels: ["labels/standards.json"],
};
writeFileSync(path.join(out, "labebal-pack.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`wrote ${templates.length} templates, ${labels.length} labels to ${out}`);

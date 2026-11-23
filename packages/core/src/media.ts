/**
 * Printer + media catalogue.
 *
 * Sizes are physical label sizes in the reading orientation (long side = width
 * for the small tape-style labels). The printable band is limited by the
 * printhead: the N1 head is 96 dots @ 203 dpi = 12 mm, so a 14 mm label only
 * gets 12 mm of print across it.
 *
 * Materials and ribbons only affect the on-screen preview and sensible
 * defaults (darkness); the printer itself only knows "dot" / "no dot".
 *
 * Sources: Niimbot's B18/N1 and M2 consumables ranges (shop listings), the
 * niimblue presets (github.com/MultiMote/niimblue) and rolls measured by hand.
 * Ids are stable: saved settings and history refer to them.
 */
import { CATALOGUE_ROLL_GROUPS } from "./known-rolls";

/**
 * How a printer makes the image:
 * - "direct": heats special heat-sensitive stock, no ribbon (shipping labels, receipts).
 * - "transfer": melts ink from a ribbon onto the stock (lasts, works on film / foil).
 * - "both": a ribbon can be loaded or not (most desktop Zebras).
 */
export type ThermalKind = "direct" | "transfer";
export type PrinterThermal = ThermalKind | "both";

/** Printer families (one driver each). */
export type PrinterFamily = "niimbot" | "brother-pt" | "zpl";

export interface PrinterProfile {
  /** Model id: niimbluelib model name ("N1", "M2_H"), "PT-D610BT", or "zpl:<printer id>" for network printers. */
  model: string;
  name: string;
  dpi: number;
  /** Printhead width in dots. */
  headDots: number;
  /** niimbluelib print direction: "left" = label feeds sideways (narrow tape printers). */
  direction: "left" | "top";
  densityMin: number;
  densityMax: number;
  densityDefault: number;
  /** Reads the loaded roll's RFID tag (remaining count, roll type). */
  rfid?: boolean;
  /** Widest tape / label roll that fits the printer, mm (across the head). */
  maxTapeMm: number;
  /** Driver family (default "niimbot"). */
  family?: PrinterFamily;
  /** Direct thermal, thermal transfer or both (default "transfer"). */
  thermal?: PrinterThermal;
  /** Where the ink comes from: a separate ribbon (default) or inside the tape cassette (Brother TZe). */
  ink?: "ribbon" | "cassette";
  /** Darkness is relative to the printer's own setting (Zebra ^MD): 0 = unchanged. */
  densityRelative?: boolean;
  /** Added at run time (network printers set up in Settings), not built in. */
  custom?: boolean;
}

export const PRINTERS: PrinterProfile[] = [
  { model: "N1", name: "Niimbot N1 / B18", dpi: 203, headDots: 96, direction: "left", densityMin: 1, densityMax: 3, densityDefault: 2, rfid: true, maxTapeMm: 15, family: "niimbot", thermal: "transfer" },
  // headDots: the real M2 reports a 576-dot printhead (docs/printers/m2-probe.json); niimbluelib's table says 567.
  { model: "M2_H", name: "Niimbot M2", dpi: 300, headDots: 576, direction: "top", densityMin: 1, densityMax: 5, densityDefault: 3, rfid: true, maxTapeMm: 50, family: "niimbot", thermal: "transfer" },
  // Brother P-touch (TZe tape, ink in the cassette): 180 dpi, 128 pins, tape up to 24 mm. No darkness control.
  { model: "PT-D610BT", name: "Brother PT-D610BT", dpi: 180, headDots: 128, direction: "left", densityMin: 1, densityMax: 1, densityDefault: 1, maxTapeMm: 24, family: "brother-pt", thermal: "transfer", ink: "cassette" },
];

export interface LabelSize {
  id: string;
  printer: string; // PrinterProfile.model
  name: string;
  /** Physical label size, reading orientation. */
  widthMm: number;
  heightMm: number;
  /** Die-cut corner radius (previews and mockups). Default 1 mm. */
  radiusMm?: number;
  /** Gap between labels on the roll, mm (along the feed). Default 2 mm. */
  gapMm?: number;
  /** Labels per roll as sold (typical; RFID reports the real count). */
  perRoll?: number;
  /** Shape / use, e.g. cable flag labels. */
  kind?: "die-cut" | "cable" | "round";
  /** Shown in quick overviews (e.g. the reflow check strip). */
  common?: boolean;
  /** Group in pickers. */
  group?: string;
  /** How the printer finds each label (default: the material's, else "gap"). */
  media?: MediaKind;
  /**
   * How the label runs through any printer: "left" = the long side along the
   * feed with the image turned (14 mm tape-style rolls), "top" = the height along
   * the feed (die-cut rolls, width across the head). Default: its printer's.
   */
  feed?: "left" | "top";
  /** Added by the user (another supplier's roll), not in the built-in list. */
  custom?: boolean;
  /**
   * Printable width across the head, mm, when it is less than the tape (Brother
   * TZe: a 12 mm tape prints 70 of the 128 pins). Default: the whole tape, up to the head.
   */
  printableMm?: number;
  /** The user's own words for finding it. */
  tags?: string[];
}

/** N1: 14 mm tape-style labels, long side along the feed. M2: die-cut labels, width across the head. */
export const SIZES: LabelSize[] = [
  // N1 / B18: 14 mm wide rolls (12 mm printable), length along the feed.
  { id: "n1-14x22", common: true, printer: "N1", name: "14 × 22 mm", widthMm: 22, heightMm: 14, perRoll: 260, group: "14 mm" },
  { id: "n1-14x28", printer: "N1", name: "14 × 28 mm", widthMm: 28, heightMm: 14, perRoll: 210, group: "14 mm" },
  { id: "n1-14x30", common: true, printer: "N1", name: "14 × 30 mm", widthMm: 30, heightMm: 14, perRoll: 210, group: "14 mm" },
  { id: "n1-14x40", common: true, printer: "N1", name: "14 × 40 mm", widthMm: 40, heightMm: 14, perRoll: 160, group: "14 mm", tags: ["akro-mils","drawer","small drawer"] },
  { id: "n1-14x50", common: true, printer: "N1", name: "14 × 50 mm", widthMm: 50, heightMm: 14, perRoll: 130, group: "14 mm" },
  { id: "n1-14x60", printer: "N1", name: "14 × 60 mm", widthMm: 60, heightMm: 14, perRoll: 110, group: "14 mm" },
  { id: "n1-14x75", printer: "N1", name: "14 × 75 mm", widthMm: 75, heightMm: 14, perRoll: 90, group: "14 mm" },
  { id: "n1-14x100", printer: "N1", name: "14 × 100 mm", widthMm: 100, heightMm: 14, perRoll: 65, group: "14 mm" },
  { id: "n1-12x40", printer: "N1", name: "12 × 40 mm", widthMm: 40, heightMm: 12, perRoll: 160, group: "12 mm" },
  // M2 die-cut, small (parts bins)
  { id: "m2-20x10", common: true, printer: "M2_H", name: "20 × 10 mm", widthMm: 20, heightMm: 10, perRoll: 400, group: "Small" },
  { id: "m2-25x10", common: true, printer: "M2_H", name: "25 × 10 mm", widthMm: 25, heightMm: 10, perRoll: 400, group: "Small" },
  { id: "m2-25x15", common: true, printer: "M2_H", name: "25 × 15 mm", widthMm: 25, heightMm: 15, perRoll: 300, group: "Small" },
  { id: "m2-30x12", common: true, printer: "M2_H", name: "30 × 12 mm", widthMm: 30, heightMm: 12, perRoll: 330, group: "Small" },
  { id: "m2-30x14", printer: "M2_H", name: "30 × 14 mm", widthMm: 30, heightMm: 14, perRoll: 300, group: "Small" },
  { id: "m2-30x15", common: true, printer: "M2_H", name: "30 × 15 mm", widthMm: 30, heightMm: 15, perRoll: 280, group: "Small" },
  { id: "m2-30x20", printer: "M2_H", name: "30 × 20 mm", widthMm: 30, heightMm: 20, perRoll: 230, group: "Small" },
  // M2 die-cut, medium / large
  { id: "m2-40x12", printer: "M2_H", name: "40 × 12 mm", widthMm: 40, heightMm: 12, perRoll: 330, group: "Medium", tags: ["akro-mils","drawer","small drawer"] },
  { id: "m2-40x20", printer: "M2_H", name: "40 × 20 mm", widthMm: 40, heightMm: 20, perRoll: 230, group: "Medium" },
  { id: "m2-40x30", printer: "M2_H", name: "40 × 30 mm", widthMm: 40, heightMm: 30, perRoll: 160, group: "Medium" },
  { id: "m2-40x40", printer: "M2_H", name: "40 × 40 mm", widthMm: 40, heightMm: 40, perRoll: 120, group: "Medium" },
  { id: "m2-40x60", printer: "M2_H", name: "40 × 60 mm", widthMm: 40, heightMm: 60, perRoll: 80, group: "Medium" },
  { id: "m2-50x15", printer: "M2_H", name: "50 × 15 mm", widthMm: 50, heightMm: 15, perRoll: 280, group: "Medium" },
  { id: "m2-50x30", printer: "M2_H", name: "50 × 30 mm", widthMm: 50, heightMm: 30, perRoll: 270, group: "Medium" },
  { id: "m2-50x50", printer: "M2_H", name: "50 × 50 mm", widthMm: 50, heightMm: 50, perRoll: 100, group: "Medium" },
  { id: "m2-50x80", printer: "M2_H", name: "50 × 80 mm", widthMm: 50, heightMm: 80, perRoll: 60, group: "Medium" },
  { id: "m2-r40", printer: "M2_H", name: "Round Ø 40 mm", widthMm: 40, heightMm: 40, radiusMm: 20, kind: "round", perRoll: 120, group: "Round" },
  { id: "m2-r30", printer: "M2_H", name: "Round Ø 30 mm", widthMm: 30, heightMm: 30, radiusMm: 15, kind: "round", perRoll: 150, group: "Round" },
  // Cable flags: the label wraps around the cable and the two halves stick together.
  { id: "m2-cable-30x25", printer: "M2_H", name: "Cable 30 × 25+40 mm", widthMm: 30, heightMm: 25, kind: "cable", perRoll: 130, group: "Cable" },
  // Brother P-touch TZe tape (continuous; length is cut to the label). Printable pins per tape width at 180 dpi.
  { id: "pt-6x30", printer: "PT-D610BT", name: "6 mm tape × 30 mm", widthMm: 30, heightMm: 6, printableMm: 4.52, media: "continuous", gapMm: 0, radiusMm: 0, group: "6 mm tape" },
  { id: "pt-6x50", printer: "PT-D610BT", name: "6 mm tape × 50 mm", widthMm: 50, heightMm: 6, printableMm: 4.52, media: "continuous", gapMm: 0, radiusMm: 0, group: "6 mm tape" },
  { id: "pt-6x75", printer: "PT-D610BT", name: "6 mm tape × 75 mm", widthMm: 75, heightMm: 6, printableMm: 4.52, media: "continuous", gapMm: 0, radiusMm: 0, group: "6 mm tape" },
  { id: "pt-6x100", printer: "PT-D610BT", name: "6 mm tape × 100 mm", widthMm: 100, heightMm: 6, printableMm: 4.52, media: "continuous", gapMm: 0, radiusMm: 0, group: "6 mm tape" },
  { id: "pt-9x30", printer: "PT-D610BT", name: "9 mm tape × 30 mm", widthMm: 30, heightMm: 9, printableMm: 7.06, media: "continuous", gapMm: 0, radiusMm: 0, group: "9 mm tape" },
  { id: "pt-9x50", printer: "PT-D610BT", name: "9 mm tape × 50 mm", widthMm: 50, heightMm: 9, printableMm: 7.06, media: "continuous", gapMm: 0, radiusMm: 0, group: "9 mm tape" },
  { id: "pt-9x75", printer: "PT-D610BT", name: "9 mm tape × 75 mm", widthMm: 75, heightMm: 9, printableMm: 7.06, media: "continuous", gapMm: 0, radiusMm: 0, group: "9 mm tape" },
  { id: "pt-9x100", printer: "PT-D610BT", name: "9 mm tape × 100 mm", widthMm: 100, heightMm: 9, printableMm: 7.06, media: "continuous", gapMm: 0, radiusMm: 0, group: "9 mm tape" },
  { id: "pt-12x30", printer: "PT-D610BT", name: "12 mm tape × 30 mm", widthMm: 30, heightMm: 12, printableMm: 9.88, media: "continuous", gapMm: 0, radiusMm: 0, group: "12 mm tape" },
  { id: "pt-12x50", printer: "PT-D610BT", name: "12 mm tape × 50 mm", widthMm: 50, heightMm: 12, printableMm: 9.88, media: "continuous", gapMm: 0, radiusMm: 0, group: "12 mm tape", common: true },
  { id: "pt-12x75", printer: "PT-D610BT", name: "12 mm tape × 75 mm", widthMm: 75, heightMm: 12, printableMm: 9.88, media: "continuous", gapMm: 0, radiusMm: 0, group: "12 mm tape" },
  { id: "pt-12x100", printer: "PT-D610BT", name: "12 mm tape × 100 mm", widthMm: 100, heightMm: 12, printableMm: 9.88, media: "continuous", gapMm: 0, radiusMm: 0, group: "12 mm tape" },
  { id: "pt-18x30", printer: "PT-D610BT", name: "18 mm tape × 30 mm", widthMm: 30, heightMm: 18, printableMm: 15.80, media: "continuous", gapMm: 0, radiusMm: 0, group: "18 mm tape" },
  { id: "pt-18x50", printer: "PT-D610BT", name: "18 mm tape × 50 mm", widthMm: 50, heightMm: 18, printableMm: 15.80, media: "continuous", gapMm: 0, radiusMm: 0, group: "18 mm tape" },
  { id: "pt-18x75", printer: "PT-D610BT", name: "18 mm tape × 75 mm", widthMm: 75, heightMm: 18, printableMm: 15.80, media: "continuous", gapMm: 0, radiusMm: 0, group: "18 mm tape" },
  { id: "pt-18x100", printer: "PT-D610BT", name: "18 mm tape × 100 mm", widthMm: 100, heightMm: 18, printableMm: 15.80, media: "continuous", gapMm: 0, radiusMm: 0, group: "18 mm tape" },
  // Akro-Mils parts cabinets: the label area on the drawer front (measured).
  { id: "pt-12x45", printer: "PT-D610BT", name: "Small parts drawer, 12 mm tape × 45 mm", widthMm: 45, heightMm: 12, printableMm: 9.88, media: "continuous", gapMm: 0, radiusMm: 0, group: "Drawers", tags: ["akro-mils", "drawer", "small drawer"] },
  { id: "pt-24x30", printer: "PT-D610BT", name: "24 mm tape × 30 mm", widthMm: 30, heightMm: 24, printableMm: 18.06, media: "continuous", gapMm: 0, radiusMm: 0, group: "24 mm tape" },
  { id: "pt-24x50", printer: "PT-D610BT", name: "24 mm tape × 50 mm", widthMm: 50, heightMm: 24, printableMm: 18.06, media: "continuous", gapMm: 0, radiusMm: 0, group: "24 mm tape", common: true },
  { id: "pt-24x75", printer: "PT-D610BT", name: "24 mm tape × 75 mm", widthMm: 75, heightMm: 24, printableMm: 18.06, media: "continuous", gapMm: 0, radiusMm: 0, group: "24 mm tape" },
  { id: "pt-24x100", printer: "PT-D610BT", name: "24 mm tape × 100 mm", widthMm: 100, heightMm: 24, printableMm: 18.06, media: "continuous", gapMm: 0, radiusMm: 0, group: "24 mm tape", tags: ["akro-mils","drawer","large drawer"] },
  // Label printers speaking ZPL (Zebra and compatibles): common die-cut sizes. "zpl" = any ZPL printer wide enough.
  { id: "zpl-in-4x6", printer: "zpl", name: "4 × 6 in", widthMm: 101.6, heightMm: 152.4, feed: "top", gapMm: 3, group: "Inch", common: true },
  { id: "zpl-in-4x4", printer: "zpl", name: "4 × 4 in", widthMm: 101.6, heightMm: 101.6, feed: "top", gapMm: 3, group: "Inch" },
  { id: "zpl-in-4x3", printer: "zpl", name: "4 × 3 in", widthMm: 101.6, heightMm: 76.2, feed: "top", gapMm: 3, group: "Inch" },
  { id: "zpl-in-4x2", printer: "zpl", name: "4 × 2 in", widthMm: 101.6, heightMm: 50.8, feed: "top", gapMm: 3, group: "Inch" },
  { id: "zpl-in-4x1", printer: "zpl", name: "4 × 1 in", widthMm: 101.6, heightMm: 25.4, feed: "top", gapMm: 3, group: "Inch", tags: ["akro-mils","drawer","large drawer"] },
  { id: "zpl-in-3x2", printer: "zpl", name: "3 × 2 in", widthMm: 76.2, heightMm: 50.8, feed: "top", gapMm: 3, group: "Inch" },
  { id: "zpl-in-3x1", printer: "zpl", name: "3 × 1 in", widthMm: 76.2, heightMm: 25.4, feed: "top", gapMm: 3, group: "Inch" },
  { id: "zpl-in-2_25x1_25", printer: "zpl", name: "2.25 × 1.25 in", widthMm: 57.15, heightMm: 31.75, feed: "top", gapMm: 3, group: "Inch", common: true },
  { id: "zpl-in-2_25x0_75", printer: "zpl", name: "2.25 × 0.75 in", widthMm: 57.15, heightMm: 19.05, feed: "top", gapMm: 3, group: "Inch" },
  { id: "zpl-in-2x1", printer: "zpl", name: "2 × 1 in", widthMm: 50.8, heightMm: 25.4, feed: "top", gapMm: 3, group: "Inch", common: true },
  { id: "zpl-in-1_5x1", printer: "zpl", name: "1.5 × 1 in", widthMm: 38.1, heightMm: 25.4, feed: "top", gapMm: 3, group: "Inch" },
  { id: "zpl-in-1_25x1", printer: "zpl", name: "1.25 × 1 in", widthMm: 31.75, heightMm: 25.4, feed: "top", gapMm: 3, group: "Inch" },
  { id: "zpl-in-1x1", printer: "zpl", name: "1 × 1 in", widthMm: 25.4, heightMm: 25.4, feed: "top", gapMm: 3, group: "Inch" },
  { id: "zpl-in-1x0_5", printer: "zpl", name: "1 × 0.5 in", widthMm: 25.4, heightMm: 12.7, feed: "top", gapMm: 3, group: "Inch" },
  { id: "zpl-100x150", printer: "zpl", name: "100 × 150 mm", widthMm: 100, heightMm: 150, feed: "top", gapMm: 3, group: "Metric" },
  { id: "zpl-100x100", printer: "zpl", name: "100 × 100 mm", widthMm: 100, heightMm: 100, feed: "top", gapMm: 3, group: "Metric" },
  { id: "zpl-100x50", printer: "zpl", name: "100 × 50 mm", widthMm: 100, heightMm: 50, feed: "top", gapMm: 3, group: "Metric" },
  { id: "zpl-60x40", printer: "zpl", name: "60 × 40 mm", widthMm: 60, heightMm: 40, feed: "top", gapMm: 3, group: "Metric" },
  { id: "zpl-57x32", printer: "zpl", name: "57 × 32 mm", widthMm: 57, heightMm: 32, feed: "top", gapMm: 3, group: "Metric" },
  { id: "zpl-50x30", printer: "zpl", name: "50 × 30 mm", widthMm: 50, heightMm: 30, feed: "top", gapMm: 3, group: "Metric" },
  { id: "zpl-50x25", printer: "zpl", name: "50 × 25 mm", widthMm: 50, heightMm: 25, feed: "top", gapMm: 3, group: "Metric" },
  { id: "zpl-40x30", printer: "zpl", name: "40 × 30 mm", widthMm: 40, heightMm: 30, feed: "top", gapMm: 3, group: "Metric" },
  { id: "zpl-38x25", printer: "zpl", name: "38 × 25 mm", widthMm: 38, heightMm: 25, feed: "top", gapMm: 3, group: "Metric" },
  { id: "zpl-32x25", printer: "zpl", name: "32 × 25 mm", widthMm: 32, heightMm: 25, feed: "top", gapMm: 3, group: "Metric" },
  { id: "zpl-25x13", printer: "zpl", name: "25 × 13 mm", widthMm: 25, heightMm: 13, feed: "top", gapMm: 3, group: "Metric" },
  // Akro-Mils parts cabinets: the label area on the drawer front (measured), cut from continuous stock.
  { id: "zpl-drawer-large", printer: "zpl", name: "Large parts drawer, 100 × 25 mm", widthMm: 100, heightMm: 25, feed: "top", gapMm: 0, media: "continuous", radiusMm: 0, group: "Drawers", tags: ["akro-mils", "drawer", "large drawer"] },
  { id: "zpl-drawer-small", printer: "zpl", name: "Small parts drawer, 45 × 15 mm", widthMm: 45, heightMm: 15, feed: "top", gapMm: 0, media: "continuous", radiusMm: 0, group: "Drawers", tags: ["akro-mils", "drawer", "small drawer"] },
  { id: "zpl-cont-100", printer: "zpl", name: "Continuous 100 mm wide, 50 mm long", widthMm: 100, heightMm: 50, feed: "top", gapMm: 0, media: "continuous", group: "Continuous" },
  { id: "zpl-cont-57", printer: "zpl", name: "Continuous 57 mm wide, 40 mm long", widthMm: 57, heightMm: 40, feed: "top", gapMm: 0, media: "continuous", group: "Continuous" },
];

export type Finish = "paper" | "matte" | "gloss" | "metallic" | "holographic" | "clear" | "fluorescent";

export interface Swatch {
  id: string;
  name: string;
  /** CSS background (colour, or layered gradients for metallics) used in previews. */
  css: string;
  /** Flat colour used when compositing the preview canvas. */
  rgb: [number, number, number];
  finish?: Finish;
  /**
   * Colour stops for painting the finish on a canvas (mockups). Metallic stops
   * run along a linear sweep; holographic stops are the diffraction rainbow.
   */
  sheen?: string[];
  /** Material darkness preset relative to the printer default (thermal transfer needs more heat on film / foil). */
  densityOffset?: number;
  /** Opacity of the stock in mockups (clear film < 1). */
  alpha?: number;
  /** How the printer finds each label on this stock (default "gap"). See `MEDIA_KINDS`. */
  media?: MediaKind;
  /**
   * Stock: "direct" = heat-sensitive (prints without a ribbon, fades in sun / heat),
   * "transfer" = needs a ribbon. Unset: works either way (plain paper with a ribbon,
   * or the printer decides).
   */
  thermal?: ThermalKind;
  /** Added by the user (shared with the team), not built in. */
  custom?: boolean;
  /** The user's own words for finding it (e.g. "freezer", "outdoor"). */
  tags?: string[];
}

/** Holographic shimmer: soft white glint over a diffraction rainbow over a base tone. */
const holo = (base: string, stops: string[]) =>
  [
    "linear-gradient(115deg, transparent 22%, rgba(255,255,255,.55) 38%, transparent 52%, rgba(255,255,255,.25) 70%, transparent 82%)",
    `conic-gradient(from 210deg at 28% 65%, ${[...stops, stops[0]].join(", ")})`,
    base,
  ].join(", ");

const metal = (stops: string[]) =>
  [
    "linear-gradient(100deg, transparent 30%, rgba(255,255,255,.6) 44%, transparent 56%)",
    `linear-gradient(170deg, ${stops.join(", ")})`,
  ].join(", ");

/** Label stock colours/finishes. */
export const MATERIALS: Swatch[] = [
  { id: "white", name: "White", css: "#ffffff", rgb: [255, 255, 255], finish: "paper" },
  // Direct thermal paper (shipping / warehouse labels on Zebras): no ribbon, darkens with heat.
  { id: "white-dt", name: "White direct thermal", css: "#fbfbf8", rgb: [251, 251, 248], finish: "paper", thermal: "direct" },
  { id: "white-matte", name: "White PET (matte)", css: "#f7f7f4", rgb: [247, 247, 244], finish: "matte", densityOffset: 1, thermal: "transfer" },
  {
    id: "transparent",
    thermal: "transfer",
    name: "Transparent",
    css: "linear-gradient(135deg, rgba(255,255,255,.7), rgba(255,255,255,.1) 60%), repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0 / 8px 8px",
    rgb: [236, 236, 236],
    finish: "clear",
    alpha: 0.18,
    densityOffset: 1,
    media: "transparent",
  },
  {
    id: "laser-gold",
    thermal: "transfer",
    name: "Laser gold (holographic)",
    // Matches the real stock: green-gold with orange/red flashes at the edges.
    css: holo("#bccf3e", ["#c4dc3a", "#e6e348", "#f0b445", "#e9d94a", "#a3d84c", "#6cc85a", "#b6e04a"]),
    rgb: [188, 207, 62],
    finish: "holographic",
    sheen: ["#c4dc3a", "#e6e348", "#f0b445", "#e9d94a", "#a3d84c", "#6cc85a", "#b6e04a"],
    densityOffset: 1,
  },
  {
    id: "laser-silver",
    thermal: "transfer",
    name: "Laser silver (holographic)",
    css: holo("#c9ced3", ["#d8dde2", "#f2c9e6", "#c9d8f6", "#c8f0e0", "#f6efc6", "#e2d0f5", "#d8dde2"]),
    rgb: [205, 210, 214],
    finish: "holographic",
    sheen: ["#d8dde2", "#f2c9e6", "#c9d8f6", "#c8f0e0", "#f6efc6", "#e2d0f5"],
    densityOffset: 1,
  },
  {
    id: "gold",
    thermal: "transfer",
    name: "Gold (metallic)",
    css: metal(["#a87a1c", "#e8c766", "#b98a26", "#f5dc8c", "#a87a1c"]),
    rgb: [212, 175, 55],
    finish: "metallic",
    sheen: ["#a87a1c", "#e8c766", "#b98a26", "#f5dc8c", "#a87a1c"],
    densityOffset: 1,
  },
  {
    id: "silver",
    thermal: "transfer",
    name: "Silver (metallic)",
    css: metal(["#8f959b", "#e6e9ec", "#a4aab0", "#f6f7f8", "#8f959b"]),
    rgb: [196, 200, 204],
    finish: "metallic",
    sheen: ["#8f959b", "#e6e9ec", "#a4aab0", "#f6f7f8", "#8f959b"],
    densityOffset: 1,
  },
  {
    id: "matte-silver",
    thermal: "transfer",
    name: "Matte silver",
    css: "linear-gradient(170deg, #b4b9be, #cdd1d5, #b9bec3)",
    rgb: [192, 196, 200],
    finish: "matte",
    sheen: ["#b4b9be", "#cdd1d5", "#b9bec3"],
    densityOffset: 1,
  },
  { id: "black", name: "Black", css: "#1a1a1a", rgb: [26, 26, 26], finish: "gloss", thermal: "transfer" },
  { id: "yellow", name: "Yellow", css: "#ffd84d", rgb: [255, 216, 77], finish: "paper", thermal: "transfer" },
  { id: "orange", name: "Orange", css: "#f58a3a", rgb: [245, 138, 58], finish: "paper", thermal: "transfer" },
  { id: "red", name: "Red", css: "#d9363e", rgb: [217, 54, 62], finish: "paper", thermal: "transfer" },
  { id: "pink", name: "Pink", css: "#f4a6c0", rgb: [244, 166, 192], finish: "paper", thermal: "transfer" },
  { id: "purple", name: "Purple", css: "#9b7fd1", rgb: [155, 127, 209], finish: "paper", thermal: "transfer" },
  { id: "blue", name: "Blue", css: "#3a7bd5", rgb: [58, 123, 213], finish: "paper", thermal: "transfer" },
  { id: "light-blue", name: "Light blue", css: "#9fd0f0", rgb: [159, 208, 240], finish: "paper", thermal: "transfer" },
  { id: "green", name: "Green", css: "#3fae5a", rgb: [63, 174, 90], finish: "paper", thermal: "transfer" },
  { id: "fluo-green", name: "Fluorescent green", css: "#b7f34a", rgb: [183, 243, 74], finish: "fluorescent", thermal: "transfer" },
  { id: "kraft", name: "Kraft", css: "#c8a27a", rgb: [200, 162, 122], finish: "matte", densityOffset: 1, thermal: "transfer" },
];

/** Ribbon colours (thermal transfer). On Brother TZe tape this is the text colour in the cassette. */
export const RIBBONS: Swatch[] = [
  { id: "black", name: "Black", css: "#111111", rgb: [17, 17, 17], thermal: "transfer" },
  { id: "white", name: "White", css: "#ffffff", rgb: [255, 255, 255] },
  { id: "blue", name: "Blue", css: "#1f4fb4", rgb: [31, 79, 180], thermal: "transfer" },
  { id: "red", name: "Red", css: "#c62828", rgb: [198, 40, 40], thermal: "transfer" },
  { id: "green", name: "Green", css: "#1f8a4c", rgb: [31, 138, 76], thermal: "transfer" },
  { id: "gold", name: "Gold", css: "#c9a227", rgb: [201, 162, 39], finish: "metallic", sheen: ["#9c7a16", "#e9cd6a", "#b48e22"] },
  { id: "silver", name: "Silver", css: "#b8bec4", rgb: [184, 190, 196], finish: "metallic", sheen: ["#8d949a", "#eef0f2", "#a7adb3"] },
];

let extraPrinters: PrinterProfile[] = [];
/** Printers set up at run time (network printers from Settings); merged into every printer lookup. */
export function setExtraPrinters(list: PrinterProfile[]) {
  extraPrinters = list.map((p) => ({ ...p, custom: true }));
}
/** Built-in and run-time printers. */
export const allPrinters = () => (extraPrinters.length ? [...PRINTERS, ...extraPrinters] : PRINTERS);
export const findPrinter = (model: string | null | undefined) => (model ? allPrinters().find((p) => p.model === model) : undefined);
export const printerFor = (model: string) => findPrinter(model) ?? PRINTERS[0];
export const familyOf = (p: PrinterProfile): PrinterFamily => p.family ?? "niimbot";

/** Stand-in for "a ZPL printer" (4 in head, 203 dpi) when previewing ZPL sizes and none is set up. */
export const GENERIC_ZPL: PrinterProfile = { model: "zpl", name: "Label printer (ZPL)", dpi: 203, headDots: 832, direction: "top", densityMin: -15, densityMax: 15, densityDefault: 0, densityRelative: true, maxTapeMm: 106, family: "zpl", thermal: "both" };

/**
 * A printer to draw a size with: the model it is made for, else a printer that
 * takes it (a set-up ZPL printer for "zpl" sizes), else the generic ZPL profile.
 */
/** Short printer name for a size list: N1, M2, P-touch, ZPL, or the profile name. */
export function sizePrinterName(size: Pick<LabelSize, "printer">): string {
  switch (size.printer) {
    case "N1":
      return "N1";
    case "M2_H":
      return "M2";
    case "zpl":
      return "ZPL";
    case "PT-D610BT":
      return "P-touch";
  }
  return findPrinter(size.printer)?.name ?? size.printer;
}

/**
 * How well a label area suits a design (both mm, width x height): 0 = same
 * shape and size; shape (aspect ratio) counts most, then area. Below
 * GOOD_FIT a design usually reflows well.
 */
export function sizeFit(design: { w: number; h: number }, area: { w: number; h: number }): number {
  if (!(design.w > 0 && design.h > 0 && area.w > 0 && area.h > 0)) return Infinity;
  const shape = Math.abs(Math.log(area.w / area.h / (design.w / design.h)));
  const scale = Math.abs(Math.log((area.w * area.h) / (design.w * design.h)));
  return shape + 0.3 * scale;
}
export const GOOD_FIT = 0.75;

export function printerForSize(size: Pick<LabelSize, "id" | "printer">): PrinterProfile {
  const own = findPrinter(size.printer);
  if (own) return own;
  if (size.printer === "zpl") return allPrinters().find((p) => familyOf(p) === "zpl" && sizesFor(p.model).some((s) => s.id === size.id)) ?? GENERIC_ZPL;
  return printerFor(size.printer);
}

let customMaterials: Swatch[] = [];
let customRibbons: Swatch[] = [];
/** Stock and ribbons the user added (shared with the team); merged into every lookup. */
export function setCustomSwatches(list: { materials?: Swatch[]; ribbons?: Swatch[] }) {
  if (list.materials) customMaterials = list.materials.map((m) => ({ ...m, custom: true }));
  if (list.ribbons) customRibbons = list.ribbons.map((r) => ({ ...r, custom: true }));
}
/** Built-in and custom stock. */
export const allMaterials = () => (customMaterials.length ? [...MATERIALS, ...customMaterials] : MATERIALS);
/** Built-in and custom ribbons. */
export const allRibbons = () => (customRibbons.length ? [...RIBBONS, ...customRibbons] : RIBBONS);

let customSizes: LabelSize[] = [];
/** Sizes the user added (other suppliers' rolls); merged into every lookup. */
export function setCustomSizes(list: LabelSize[]) {
  customSizes = list.map((s) => ({ ...s, custom: true }));
}
/** Built-in and custom sizes. */
export const allSizes = () => (customSizes.length ? [...SIZES, ...customSizes] : SIZES);

/** Which way a size runs through the printer (see `LabelSize.feed`). */
export const feedOf = (s: LabelSize): "left" | "top" => s.feed ?? printerFor(s.printer).direction;
/** Width of the roll across the printhead, mm. */
export const tapeWidthMm = (s: LabelSize) => (feedOf(s) === "left" ? s.heightMm : s.widthMm);
/** The roll fits in this printer (anything wider than the head is simply not printed at the edges). */
export const sizeFits = (s: LabelSize, p: PrinterProfile) => tapeWidthMm(s) <= p.maxTapeMm + 0.01;

/** A size belongs to this printer: made for the model, or for its whole family ("zpl" sizes on every ZPL printer). */
const ownSize = (s: LabelSize, p: PrinterProfile) => s.printer === p.model || (familyOf(p) !== "niimbot" && s.printer === familyOf(p) && sizeFits(s, p));
/** Sizes sold for this printer, plus custom sizes that fit it. */
export const sizesFor = (model: string) => {
  const p = printerFor(model);
  return allSizes().filter((s) => ownSize(s, p) || (s.custom && sizeFits(s, p)));
};
/**
 * Sizes made for other printers that also fit this one (e.g. N1 14 mm rolls in
 * an M2). Only within the same kind of media: TZe tape fits only P-touch printers.
 */
export const otherSizesFor = (model: string) => {
  const p = printerFor(model);
  const tape = (s: LabelSize) => findPrinter(s.printer)?.family === "brother-pt";
  return SIZES.filter((s) => !ownSize(s, p) && s.printer !== "zpl" && tape(s) === (familyOf(p) === "brother-pt") && sizeFits(s, p));
};
/** Any size this printer can print. */
export const usableSizes = (model: string) => [...sizesFor(model), ...otherSizesFor(model)];
export const sizeById = (id: string) => allSizes().find((s) => s.id === id);
export const materialById = (id: string) => allMaterials().find((m) => m.id === id) ?? MATERIALS[0];
export const ribbonById = (id: string) => allRibbons().find((r) => r.id === id) ?? RIBBONS[0];

/** Default darkness for a printer + stock (before any user override). */
export function materialDensity(printer: PrinterProfile, materialId: string) {
  const off = allMaterials().find((m) => m.id === materialId)?.densityOffset ?? 0;
  return Math.max(printer.densityMin, Math.min(printer.densityMax, printer.densityDefault + off));
}

/**
 * Direct thermal or thermal transfer for this printer + stock, and whether the
 * combination works. `problem` is a plain sentence for the person printing.
 */
export function thermalFor(printer: PrinterProfile, materialId: string, printerMode?: ThermalKind): { kind: ThermalKind; ribbon: boolean; problem?: string } {
  const stock = materialById(materialId);
  const p = printer.thermal ?? "transfer";
  if (p === "direct") {
    if (stock.thermal === "transfer") return { kind: "direct", ribbon: false, problem: `${stock.name} needs a ribbon, but the ${printer.name} only prints direct thermal (no ribbon). Use direct thermal stock.` };
    return { kind: "direct", ribbon: false };
  }
  if (p === "transfer") return { kind: "transfer", ribbon: true };
  // Both: the stock decides; stock that works either way follows how the printer is set up (else a ribbon).
  const kind = stock.thermal ?? printerMode ?? "transfer";
  return { kind, ribbon: kind === "transfer" };
}

export const THERMAL_NAMES: Record<ThermalKind, { short: string; name: string; help: string }> = {
  direct: { short: "DT", name: "Direct thermal", help: "No ribbon: the heat darkens special heat-sensitive stock. Fine for shipping and short-lived labels; fades with sun and heat." },
  transfer: { short: "TT", name: "Thermal transfer", help: "Ink melts from a ribbon onto the stock. Lasts, and works on film, foil and coloured stock." },
};

/** Corner radius of a size in mm (die-cut labels are rounded; default 1 mm). */
export const cornerRadiusMm = (s: LabelSize) => s.radiusMm ?? (s.kind === "round" ? Math.min(s.widthMm, s.heightMm) / 2 : 1);

/** Label length along the feed (mm): N1 feeds the long side, M2 the height. */
export const feedLengthMm = (s: LabelSize) => (feedOf(s) === "left" ? s.widthMm : s.heightMm);

/**
 * Pixel geometry of a label for a printer. The canvas we draw is the full label
 * in reading orientation; the printable band across the head is clamped.
 */
export function labelPixels(size: LabelSize, printer: PrinterProfile) {
  const dpmm = printer.dpi / 25.4;
  let w = Math.round(size.widthMm * dpmm);
  let h = Math.round(size.heightMm * dpmm);
  // The axis across the printhead depends on feed direction.
  // The axis across the printhead depends on how this size runs through the printer.
  const feed = feedOf(size);
  const band = Math.min(printer.headDots, size.printableMm ? Math.round(size.printableMm * dpmm) : Infinity);
  if (feed === "left") h = Math.min(h, band);
  else w = Math.min(w, band);
  // The Niimbot encoder pads the across-head axis to a multiple of 8; keep it aligned so preview == print.
  if (familyOf(printer) === "niimbot") {
    if (feed === "left") h -= h % 8;
    else w -= w % 8;
  }
  return { w, h, dpmm };
}

/* ------------------------------------------------------------ RFID rolls */

/** What the printer reports about the loaded roll (niimbluelib RFID + paper info). */
export interface RollInfo {
  /** Roll barcode printed on the box / stored in the tag (identifies the product). */
  barcode: string;
  serial: string;
  /** Labels on a full roll and how many were used. */
  total: number;
  used: number;
  /** niimbluelib LabelType (1 = with gaps, 2 = black mark, 3 = continuous, 5 = transparent...). */
  type: number;
  /** Label length along the feed incl. gap, and the gap, in dots (if the printer reports it). */
  totalDots?: number;
  gapDots?: number;
  /** Ribbon (thermal transfer) tag, when present. */
  ribbon?: { barcode: string; serial?: string; total: number; used: number } | null;
}

export const rollRemaining = (r: RollInfo) => Math.max(0, r.total - r.used);

/**
 * Typical calibration per model, offered as a suggestion when a printer of that
 * model connects without its own saved calibration (each printer can differ,
 * so it is always confirmed with a test print). Offsets in dots: +x moves the
 * print right, +y moves it down.
 */
export const MODEL_CALIBRATION_HINTS: Record<string, { offset: { x: number; y: number }; basis: string }> = {
  M2_H: { offset: { x: 0, y: 6 }, basis: "Measured on an M2 (firmware 1.50): prints about 0.5 mm high without it." },
};

/**
 * Known roll barcodes (from the roll's RFID tag) -> size / material, for
 * printers that don't report the label length (N1 / B18). Checked on real
 * rolls first, then the Niimbot label catalogue (src/known-rolls.ts, generated
 * by scripts/known-rolls.ts from github.com/ywy50/niimbench). The app also
 * remembers the size a user picked for an unknown barcode (learned rolls).
 */
export const KNOWN_ROLLS: Record<string, { sizeId: string; materialId?: string }> = {
  ...Object.fromEntries(CATALOGUE_ROLL_GROUPS.flatMap(([sizeId, materialId, codes]) => codes.split(" ").map((c) => [c, materialId ? { sizeId, materialId } : { sizeId }]))),
  // Verified on a real N1 (docs/printers/n1-probe.json): laser gold roll (tag total 228 = 190 labels x 1.2).
  // Also in the catalogue as an alias of roll 022824294 "EL14*30-190Laser Gold".
  "08062224": { sizeId: "n1-14x30", materialId: "laser-gold" },
};

/** niimbluelib LabelType for transparent stock. */
const LABEL_TYPE_TRANSPARENT = 5;

/**
 * Best guess of the loaded roll's size (and material) from its RFID data:
 * known barcode first, then label length along the feed (+ roll capacity).
 */
export function matchRoll(roll: RollInfo, printer: PrinterProfile, learned: Record<string, { sizeId: string; materialId?: string }> = {}) {
  const known = learned[roll.barcode] ?? KNOWN_ROLLS[roll.barcode];
  const knownSize = known && sizeById(known.sizeId);
  if (known && knownSize && sizeFits(knownSize, printer)) return { ...known, sure: true };
  const materialId = roll.type === LABEL_TYPE_TRANSPARENT ? "transparent" : undefined;
  if (!roll.totalDots) return null;
  const dpmm = printer.dpi / 25.4;
  const pitchMm = roll.totalDots / dpmm;
  const gapMm = (roll.gapDots ?? 0) / dpmm;
  // Some firmwares report the label length, others label + gap; accept both.
  const lens = [pitchMm, pitchMm - gapMm, pitchMm - 2];
  let best: { size: LabelSize; score: number } | null = null;
  for (const s of sizesFor(printer.model)) {
    const len = feedLengthMm(s);
    let score = Math.min(...lens.map((l) => Math.abs(l - len)));
    if (s.perRoll && roll.total) score += Math.min(2, Math.abs(s.perRoll - roll.total) / 100);
    if (!best || score < best.score) best = { size: s, score };
  }
  if (!best || best.score > 2.5) return null;
  return { sizeId: best.size.id, materialId, sure: false };
}

/* ------------------------------------------------------------ label (media) type */

/**
 * How the printer finds where each label starts. Sent to the printer as the
 * niimbluelib `LabelType` at the start of every print; the wrong one makes
 * labels drift or the printer feed blank labels.
 */
export type MediaKind = "gap" | "black-mark" | "continuous" | "transparent";

export const MEDIA_KINDS: { id: MediaKind; name: string; hint: string; labelType: number }[] = [
  { id: "gap", name: "Labels with gaps", hint: "Die-cut labels with a small gap between them (most rolls). The printer looks for the gap.", labelType: 1 },
  { id: "black-mark", name: "Black mark", hint: "Rolls with a black line printed on the back between labels.", labelType: 2 },
  { id: "continuous", name: "Continuous tape", hint: "One long strip without gaps; each label is cut or torn off to length.", labelType: 3 },
  { id: "transparent", name: "Transparent labels", hint: "Clear labels: the printer uses a different sensor setting to find the gap.", labelType: LABEL_TYPE_TRANSPARENT },
];

export const mediaKindById = (id: MediaKind | undefined) => MEDIA_KINDS.find((k) => k.id === id) ?? MEDIA_KINDS[0];
/** niimbluelib LabelType number -> MediaKind (undefined for types not handled here, e.g. tubes / PVC tags). */
export const mediaKindFromLabelType = (t: number | undefined) => MEDIA_KINDS.find((k) => k.labelType === t)?.id;

/**
 * Media kind to print with, highest priority first: the user's override for
 * this printer, the loaded roll's RFID tag, the label size, the material, "gap".
 */
export function resolveMediaKind(o: { override?: MediaKind | null; rollType?: number | null; sizeId?: string; materialId?: string }): MediaKind {
  if (o.override) return o.override;
  const fromRoll = mediaKindFromLabelType(o.rollType ?? undefined);
  if (fromRoll) return fromRoll;
  const size = o.sizeId ? sizeById(o.sizeId) : undefined;
  if (size?.media) return size.media;
  const mat = o.materialId ? MATERIALS.find((m) => m.id === o.materialId) : undefined;
  return mat?.media ?? "gap";
}

/* ------------------------------------------------------------ roll / ribbon usage */

/** Our own count for one roll or ribbon (by RFID serial), kept per browser. */
export interface ConsumableUsage {
  kind: "roll" | "ribbon";
  barcode: string;
  /** Capacity from the tag. */
  total: number;
  /** The tag's "used" value when first seen. */
  usedAtStart: number;
  /** Labels printed by labebal on it since. */
  printed: number;
  firstSeen: number;
  lastUsed?: number;
}

/** Key for a roll / ribbon: RFID serial, else barcode. */
export const consumableKey = (kind: "roll" | "ribbon", serial: string | undefined, barcode: string) => `${kind}:${serial || barcode || "?"}`;

/**
 * Remaining labels: the more pessimistic of the tag (most firmware updates it
 * after printing) and our own count since the roll was first seen.
 */
export function usageEstimate(u: ConsumableUsage | undefined, tag: { total: number; used: number }) {
  const total = tag.total || u?.total || 0;
  const used = Math.max(tag.used, u ? u.usedAtStart + u.printed : 0);
  return { total, used, left: Math.max(0, total - used), printedHere: u?.printed ?? 0 };
}

/** "low" under 10 % (or under 15 left), "empty" at 0; null without a known capacity. */
export function usageLevel(left: number, total: number): "ok" | "low" | "empty" | null {
  if (!total) return null;
  if (left <= 0) return "empty";
  return left / total < 0.1 || left < 15 ? "low" : "ok";
}

/** Record `n` printed labels on a roll / ribbon (creates the record on first use). */
export function addUsage(
  map: Record<string, ConsumableUsage>,
  key: string,
  info: { kind: "roll" | "ribbon"; barcode: string; total: number; used: number },
  n: number,
  now = Date.now(),
): Record<string, ConsumableUsage> {
  const prev = map[key] ?? { kind: info.kind, barcode: info.barcode, total: info.total, usedAtStart: info.used, printed: 0, firstSeen: now };
  return { ...map, [key]: { ...prev, total: info.total || prev.total, printed: prev.printed + Math.max(0, n), lastUsed: now } };
}

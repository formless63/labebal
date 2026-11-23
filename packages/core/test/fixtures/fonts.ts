/**
 * Fonts for headless render tests: the app's built-ins (packages/app/assets/fonts)
 * plus three small pixel fonts (scripts/make-test-fonts.mjs). Importing this
 * registers the pixel fonts with the core font registry like uploaded fonts;
 * `registerTestFonts()` loads every file into @napi-rs/canvas.
 */
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GlobalFonts } from "@napi-rs/canvas";
import { BUILTIN_FONTS, registerFont, type FontDef } from "../../src";

const here = dirname(fileURLToPath(import.meta.url));
const appFonts = resolve(here, "../../../../packages/app/assets/fonts");

const PIXEL_FONTS: (FontDef & { file: string })[] = [
  { px: 8, linePx: 9 },
  { px: 12, linePx: 12 },
  { px: 16, linePx: 15 },
].map(({ px, linePx }) => ({
  family: `Test Pixel ${px}`,
  url: `/fonts/TestPixel${px}.otf`,
  pixel: { pxPerEm: px, linePx },
  file: join(here, "fonts", `TestPixel${px}.otf`),
}));
for (const { family, url, pixel } of PIXEL_FONTS) registerFont({ family, url, pixel });

/** Every test font with its file on disk. */
export const TEST_FONTS: (FontDef & { file: string })[] = [
  ...BUILTIN_FONTS.map((f) => ({ ...f, file: join(appFonts, f.url.replace(/^\/fonts\//, "")) })),
  ...PIXEL_FONTS,
];

export function registerTestFonts() {
  for (const f of TEST_FONTS) if (!GlobalFonts.registerFromPath(f.file, f.family)) throw new Error(`font ${f.family} failed to load`);
}

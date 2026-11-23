/**
 * Writes the pixel fonts the tests use (test/fixtures/fonts/*.otf): one 5 x 7
 * letterform set drawn for this repo, at 8, 12 and 16 font pixels per em.
 *
 *   node packages/core/scripts/make-test-fonts.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as ot from "opentype.js";

const opentype = ot.Font ? ot : ot.default;
const out = join(dirname(fileURLToPath(import.meta.url)), "../test/fixtures/fonts");
mkdirSync(out, { recursive: true });

/** 7 rows of 5 bits each (top row first), two hex digits per row. */
const GLYPHS = {
  A: "0e11111f111111", B: "1e11111e11111e", C: "0e11101010110e", D: "1e11111111111e", E: "1f10101e10101f",
  F: "1f10101e101010", G: "0e11101711110f", H: "1111111f111111", I: "0e04040404040e", J: "0702020202120c",
  K: "11121418141211", L: "1010101010101f", M: "111b1515111111", N: "11191513111111", O: "0e11111111110e",
  P: "1e11111e101010", Q: "0e11111115120d", R: "1e11111e141211", S: "0f10100e01011e", T: "1f040404040404",
  U: "1111111111110e", V: "11111111110a04", W: "1111111515150a", X: "11110a040a1111", Y: "11110a04040404",
  Z: "1f01020408101f",
  0: "0e11131519110e", 1: "040c040404040e", 2: "0e11010204081f", 3: "1f02040201110e", 4: "02060a121f0202",
  5: "1f101e0101110e", 6: "0608101e11110e", 7: "1f010204080808", 8: "0e11110e11110e", 9: "0e11110f01020c",
  "-": "0000001f000000", "+": "0004041f040400", "/": "00010204081000", ".": "00000000000c0c", ",": "000000000c0408",
  ":": "000c0c000c0c00", "(": "02040808080402", ")": "08040202020408", "!": "04040404000004", "?": "0e110102040004",
  "'": "0c040800000000", "&": "0c12140815120d", "#": "0a0a1f0a1f0a0a", "=": "00001f001f0000", _: "0000000000001f",
};

const UNIT = 100; // font units per font pixel

function glyphPath(hex) {
  const p = new opentype.Path();
  for (let row = 0; row < 7; row++) {
    const bits = parseInt(hex.slice(row * 2, row * 2 + 2), 16);
    for (let x = 0; x < 5; x++) {
      if (!(bits & (16 >> x))) continue;
      let end = x;
      while (end < 5 && bits & (16 >> end)) end++;
      const top = (7 - row) * UNIT;
      const bottom = top - UNIT;
      p.moveTo(x * UNIT, bottom);
      p.lineTo(end * UNIT, bottom);
      p.lineTo(end * UNIT, top);
      p.lineTo(x * UNIT, top);
      p.close();
      x = end;
    }
  }
  return p;
}

const glyph = (name, unicode, hex, advance) =>
  new opentype.Glyph({ name, unicode, advanceWidth: advance * UNIT, path: hex ? glyphPath(hex) : new opentype.Path() });

for (const [px, ascent, descent] of [
  [8, 7, 2],
  [12, 9, 3],
  [16, 12, 3],
]) {
  const glyphs = [glyph(".notdef", undefined, "1f11111111111f", 6), glyph("space", 32, "", 4)];
  for (const [ch, hex] of Object.entries(GLYPHS)) {
    const cp = ch.codePointAt(0);
    glyphs.push(glyph(`u${cp}`, cp, hex, 6));
    // Lowercase letters use the capitals.
    if (/[A-Z]/.test(ch)) glyphs.push(glyph(`u${cp + 32}`, cp + 32, hex, 6));
  }
  const font = new opentype.Font({
    familyName: `Test Pixel ${px}`,
    styleName: "Regular",
    unitsPerEm: px * UNIT,
    ascender: ascent * UNIT,
    descender: -descent * UNIT,
    designer: "labebal contributors",
    license: "MIT",
    glyphs,
  });
  writeFileSync(join(out, `TestPixel${px}.otf`), Buffer.from(font.toArrayBuffer()));
}

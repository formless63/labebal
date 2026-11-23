import { describe, expect, it } from "vitest";
import { bitsToZpl, parseHostConfig, parseHostIdentity, parseHostStatus, zplGraphic, type Bitmap1 } from "../src/zpl-print";

/** Decode a ^GFA field back into bytes (the ZPL ASCII compression rules). */
function decode(gfa: string): { bytesPerRow: number; data: Uint8Array } {
  const m = /^\^GFA,(\d+),(\d+),(\d+),(.*)$/.exec(gfa)!;
  const total = Number(m[1]);
  const bpr = Number(m[3]);
  const rowHex = bpr * 2;
  const rows: string[] = [];
  let row = "";
  let count = 0;
  const push = (s: string) => {
    row += s;
    if (row.length === rowHex) {
      rows.push(row);
      row = "";
    }
  };
  for (const ch of m[4]) {
    if (ch >= "G" && ch <= "Y") count += ch.charCodeAt(0) - 70;
    else if (ch >= "g" && ch <= "z") count += (ch.charCodeAt(0) - 102) * 20;
    else if (ch === ",") {
      push("0".repeat(rowHex - row.length));
      count = 0;
    } else if (ch === "!") {
      push("F".repeat(rowHex - row.length));
      count = 0;
    } else if (ch === ":") {
      rows.push(rows[rows.length - 1]);
    } else {
      push(ch.repeat(count || 1));
      count = 0;
    }
  }
  const hex = rows.join("");
  expect(hex.length).toBe(total * 2);
  const data = new Uint8Array(total);
  for (let i = 0; i < total; i++) data[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return { bytesPerRow: bpr, data };
}

function bitmap(width: number, height: number, dot: (x: number, y: number) => boolean): Bitmap1 {
  const bytesPerRow = Math.ceil(width / 8);
  const data = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (dot(x, y)) data[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
  return { width, height, bytesPerRow, data };
}

describe("ZPL graphic", () => {
  it("round-trips through the compression", () => {
    const b = bitmap(812, 300, (x, y) => (x > 100 && x < 700 && y > 20 && y < 60) || (x + y) % 37 === 0 || (y > 200 && y < 210));
    const g = zplGraphic(b);
    expect(decode(g).data).toEqual(b.data);
    // Compressed well below raw hex for a mostly empty label.
    expect(g.length).toBeLessThan(b.data.length);
  });

  it("handles long runs, blank rows and full rows", () => {
    const b = bitmap(3200, 6, (x, y) => y === 1 || (y === 3 && x < 1500) || (y === 4 && x >= 8));
    expect(decode(zplGraphic(b)).data).toEqual(b.data);
  });

  it("builds a whole format", () => {
    const b = bitmap(16, 2, () => true);
    const z = bitsToZpl(b, { qty: 3, mediaKind: "continuous", thermal: "transfer", darkness: 5, lengthDots: 40 });
    expect(z.startsWith("^XA")).toBe(true);
    expect(z).toContain("^PW16");
    expect(z).toContain("^LL40");
    expect(z).toContain("^MNN");
    expect(z).toContain("^MTT");
    expect(z).toContain("^MD5");
    expect(z).toContain("^PQ3,0,1,Y");
    expect(z.endsWith("^XZ")).toBe(true);
  });
});

describe("Zebra replies", () => {
  // Real replies from a ZD500 (203 dpi) and a GX430t (300 dpi).
  it("reads ~HI", () => {
    expect(parseHostIdentity("\u0002ZD500-200dpi,V74.20.22Z,8,4096KB\u0003\r\n")).toEqual({ model: "ZD500-200dpi", firmware: "V74.20.22Z", dpmm: 8 });
    expect(parseHostIdentity("\u0002GX430t-300dpi,V56.17.11Z,12,2104KB\u0003\r\n")?.dpmm).toBe(12);
  });

  it("reads ~HS", () => {
    const ok = parseHostStatus("\u0002030,0,0,1218,000,0,0,0,000,0,0,0\u0003\r\n\u0002000,0,0,0,0,2,6,0,00000000,1,000\u0003\r\n\u00020000,0\u0003\r\n")!;
    expect(ok.problem).toBeUndefined();
    expect(ok.thermalTransfer).toBe(false);
    const bad = parseHostStatus("\u0002030,1,0,1218,000,0,0,0,000,0,0,0\u0003\r\n\u0002000,0,1,0,1,2,6,0,00000012,1,000\u0003\r\n")!;
    expect(bad.paperOut).toBe(true);
    expect(bad.headOpen).toBe(true);
    expect(bad.thermalTransfer).toBe(true);
    expect(bad.remaining).toBe(12);
    expect(bad.problem).toBe("The printhead is open.");
  });

  it("reads ^HH", () => {
    const c = parseHostConfig(
      ["  +10.0               DARKNESS          ", "  DIRECT-THERMAL      PRINT METHOD      ", "  812                 PRINT WIDTH       ", "  1218                LABEL LENGTH      ", "  GAP/NOTCH           MEDIA TYPE        ", "   832 8/MM FULL      RESOLUTION        "].join("\r\n"),
    );
    expect(c).toEqual({ darkness: 10, method: "direct", printWidth: 812, labelLength: 1218, mediaType: "GAP/NOTCH", headDots: 832, dpmm: 8 });
  });
});

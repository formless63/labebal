/** Minimal types for opentype.js 2.x (the package ships none); only what core uses. */
declare module "opentype.js" {
  export interface PathCommand {
    type: string;
    x?: number;
    y?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
  }
  export interface Glyph {
    index: number;
    advanceWidth?: number;
    path: { commands: PathCommand[] };
  }
  export interface Font {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    names: Record<string, unknown>;
    tables: Record<string, unknown>;
    charToGlyph(ch: string): Glyph;
  }
  export function parse(buffer: ArrayBuffer, opts?: Record<string, unknown>): Font;
}

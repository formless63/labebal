/**
 * Proof sheet: a contact-sheet PDF of rendered labels at true size, to laser-print
 * for approval. Each label is drawn as its 1-bit dots (an image mask, so it stays
 * crisp at any zoom) inside the label's outline, with its name underneath. A
 * 50 mm ruler on every page checks that it was printed at 100 %.
 *
 * Framework-free; tiny hand-written PDF (no dependency). Needs `CompressionStream`.
 */
import { packRows, zlibDeflate, type Bitmap } from "./png";

export interface ProofItem {
  name: string;
  /** Second caption line, e.g. "30 × 12 mm · ×3". */
  caption?: string;
  /** Physical label size, mm. */
  widthMm: number;
  heightMm: number;
  /** Rendered dots (the printable band). */
  bitmap: Bitmap;
  /** Dots per mm of the bitmap. */
  dpmm: number;
  /** Top-left of the bitmap on the label, mm (the printable band is centred on wide stock). */
  x?: number;
  y?: number;
}

export interface ProofOptions {
  page?: "a4" | "letter";
  marginMm?: number;
  gapMm?: number;
  title?: string;
  /** Printed under the title (default: today's date). */
  subtitle?: string;
}

const PT = 72 / 25.4;
const PAGES = { a4: [210, 297], letter: [215.9, 279.4] } as const;
const CAPTION_MM = 6;
const HEADER_MM = 14;

/** Latin-1 PDF string literal; other characters become "?". */
const pdfString = (s: string) =>
  `(${[...s]
    .map((c) => (c.charCodeAt(0) > 255 ? "?" : c))
    .join("")
    .replace(/[\\()]/g, (m) => `\\${m}`)
    .replace(/[\r\n]+/g, " ")})`;

const n = (v: number) => (Math.round(v * 100) / 100).toString();

/** Fit `text` into `maxMm` at `pt` size (Helvetica ~0.5 em per char average). */
const clip = (text: string, maxMm: number, pt: number) => {
  const max = Math.max(4, Math.floor(maxMm / (pt * 0.5 * (25.4 / 72))));
  return text.length > max ? text.slice(0, max - 3) + "..." : text;
};

interface Placed {
  item: ProofItem;
  page: number;
  x: number; // mm from left
  y: number; // mm from top
}

/** Flow labels left to right, top to bottom, onto pages. */
export function layoutProof(items: ProofItem[], opts: ProofOptions = {}): { placed: Placed[]; pages: number; pageMm: readonly [number, number] } {
  const [pw, ph] = PAGES[opts.page ?? "a4"];
  const margin = opts.marginMm ?? 10;
  const gap = opts.gapMm ?? 4;
  const top = margin + HEADER_MM;
  const placed: Placed[] = [];
  let page = 0, x = margin, y = top, rowH = 0;
  for (const item of items) {
    const w = Math.min(item.widthMm, pw - 2 * margin);
    const h = item.heightMm + CAPTION_MM;
    if (x > margin && x + w > pw - margin) {
      x = margin;
      y += rowH + gap;
      rowH = 0;
    }
    if (y > top && y + h > ph - margin) {
      page++;
      x = margin;
      y = top;
      rowH = 0;
    }
    placed.push({ item, page, x, y });
    x += Math.max(w, 20) + gap;
    rowH = Math.max(rowH, h);
  }
  return { placed, pages: Math.max(1, page + 1), pageMm: [pw, ph] };
}

export async function proofSheetPdf(items: ProofItem[], opts: ProofOptions = {}): Promise<Uint8Array> {
  const { placed, pages, pageMm } = layoutProof(items, opts);
  const [pw, ph] = pageMm;
  const margin = opts.marginMm ?? 10;
  const title = opts.title ?? "Label proof";
  const subtitle = opts.subtitle ?? new Date().toISOString().slice(0, 10);
  const enc = new TextEncoder();
  const latin1 = (s: string) => Uint8Array.from([...s].map((c) => Math.min(255, c.charCodeAt(0))));

  // Object numbers: 1 catalog, 2 pages, 3 font, then per page (page, content), then images.
  const objs: Uint8Array[][] = [];
  const add = (parts: Uint8Array[]) => (objs.push(parts), objs.length);
  const catalog = add([]);
  const pagesObj = add([]);
  const font = add([enc.encode("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")]);

  const images: number[] = [];
  for (const p of placed) {
    const b = p.item.bitmap;
    const data = await zlibDeflate(packRows(b, 1));
    images.push(
      add([
        enc.encode(`<< /Type /XObject /Subtype /Image /Width ${b.w} /Height ${b.h} /ImageMask true /BitsPerComponent 1 /Decode [1 0] /Filter /FlateDecode /Length ${data.length} >>\nstream\n`),
        data,
        enc.encode("\nendstream"),
      ]),
    );
  }

  const X = (mm: number) => n(mm * PT);
  const Y = (mm: number) => n((ph - mm) * PT);
  const pageIds: number[] = [];
  for (let pg = 0; pg < pages; pg++) {
    const ops: string[] = [];
    // Header: title, date, page, 50 mm ruler.
    ops.push(`BT /F1 11 Tf ${X(margin)} ${Y(margin + 4)} Td ${pdfString(title)} Tj ET`);
    ops.push(`BT /F1 7 Tf ${X(margin)} ${Y(margin + 8.5)} Td ${pdfString(`${subtitle}  ·  page ${pg + 1} of ${pages}  ·  print at 100 % (actual size)`)} Tj ET`);
    const rx = pw - margin - 50, ry = margin + 6;
    ops.push(`0 G 0.4 w ${X(rx)} ${Y(ry)} m ${X(rx + 50)} ${Y(ry)} l S`);
    for (let i = 0; i <= 50; i += 5) ops.push(`${X(rx + i)} ${Y(ry)} m ${X(rx + i)} ${Y(ry - (i % 10 ? 1 : 2))} l S`);
    ops.push(`BT /F1 6 Tf ${X(rx + 18)} ${Y(ry + 3)} Td ${pdfString("50 mm")} Tj ET`);

    placed.forEach((p, i) => {
      if (p.page !== pg) return;
      const { item } = p;
      const bw = item.bitmap.w / item.dpmm, bh = item.bitmap.h / item.dpmm;
      const ix = p.x + (item.x ?? (item.widthMm - bw) / 2);
      const iy = p.y + (item.y ?? (item.heightMm - bh) / 2);
      // Label outline (light grey hairline), dots in black.
      ops.push(`0.6 G 0.25 w ${X(p.x)} ${Y(p.y + item.heightMm)} ${n(item.widthMm * PT)} ${n(item.heightMm * PT)} re S`);
      ops.push(`q 0 g ${n(bw * PT)} 0 0 ${n(bh * PT)} ${X(ix)} ${Y(iy + bh)} cm /Im${i} Do Q`);
      const capW = Math.max(item.widthMm, 20);
      ops.push(`0 g BT /F1 6 Tf ${X(p.x)} ${Y(p.y + item.heightMm + 2.4)} Td ${pdfString(clip(item.name, capW, 6))} Tj ET`);
      if (item.caption) ops.push(`0.4 g BT /F1 5 Tf ${X(p.x)} ${Y(p.y + item.heightMm + 4.6)} Td ${pdfString(clip(item.caption, capW, 5))} Tj ET`);
    });
    const content = latin1(ops.join("\n"));
    const contentId = add([enc.encode(`<< /Length ${content.length} >>\nstream\n`), content, enc.encode("\nendstream")]);
    const xobjs = placed.map((p, i) => (p.page === pg ? `/Im${i} ${images[i]} 0 R` : "")).filter(Boolean).join(" ");
    pageIds.push(
      add([
        enc.encode(
          `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${n(pw * PT)} ${n(ph * PT)}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${font} 0 R >> /XObject << ${xobjs} >> >> >>`,
        ),
      ]),
    );
  }
  objs[catalog - 1] = [enc.encode(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`)];
  objs[pagesObj - 1] = [enc.encode(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`)];

  const out: Uint8Array[] = [enc.encode("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")];
  let offset = out[0].length;
  const offsets: number[] = [];
  objs.forEach((parts, i) => {
    offsets.push(offset);
    const chunk = [enc.encode(`${i + 1} 0 obj\n`), ...parts, enc.encode("\nendobj\n")];
    for (const c of chunk) (out.push(c), (offset += c.length));
  });
  const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
  out.push(enc.encode(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
  const all = new Uint8Array(out.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const c of out) (all.set(c, o), (o += c.length));
  return all;
}

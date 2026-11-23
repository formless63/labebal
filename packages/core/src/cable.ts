/**
 * Cable flags and wraps.
 *
 * A cable flag is a strip folded around a cable with its two ends stuck
 * together: [half A][wrap zone][half B]. The wrap zone stays blank and is as
 * long as the cable's circumference; half B is a live copy of half A so the
 * flag reads on both sides:
 *
 *   - "reflect": positions flipped left-right (letters are not mirrored), so
 *     after folding the two halves sit back to back with matching edges. Use
 *     for a strip folded around a cable running across it.
 *   - "rotate": turned 180°, for a strip that hangs down from the cable (read
 *     the other side by turning the flag over top to bottom).
 *   - "repeat": the same layout again (Brother-style flags, wrap-around labels
 *     that repeat their text along the length).
 *
 * Both are plain frame properties (`FrameNode.mirror`, `wrapDiameterMm`),
 * resolved by `layout()`: no new node type, so everything else (editor,
 * variants, overrides) keeps working.
 */
import type { Box, LaidOut } from "./layout";
import type { FrameNode, LabelNode, MirrorSpec, Rotation } from "./schema";

/** Extra length added to the circumference so the strip closes comfortably, mm. */
export const WRAP_ALLOWANCE_MM = 0.5;

/** Length of strip that goes once around a cable of this diameter (mm). */
export const cableWrapMm = (diameterMm: number, allowanceMm = WRAP_ALLOWANCE_MM) => Math.max(0, Math.PI * Math.max(0, diameterMm) + allowanceMm);

/** Common cable diameters for pickers (mm). */
export const CABLE_DIAMETERS: { mm: number; label: string }[] = [
  { mm: 3, label: "3 mm (USB / headphone)" },
  { mm: 4, label: "4 mm (USB-C, thin power)" },
  { mm: 5, label: "5 mm (network)" },
  { mm: 6, label: "6 mm (HDMI, mains)" },
  { mm: 8, label: "8 mm (thick AV, mains)" },
  { mm: 10, label: "10 mm" },
];

/**
 * Turn `wrapDiameterMm` into a fixed size along the parent's main axis
 * (row: width, column: height, free: width). Mutates the (cloned) tree.
 */
export function applyCableSizing(root: FrameNode) {
  const visit = (f: FrameNode) => {
    for (const c of f.children) {
      if (c.type !== "frame") continue;
      if (c.wrapDiameterMm !== undefined && c.wrapDiameterMm > 0) {
        const len = { kind: "fixed" as const, mm: cableWrapMm(c.wrapDiameterMm) };
        if (f.layout === "column") c.h = len;
        else c.w = len;
      }
      visit(c);
    }
  };
  visit(root);
}

const turn = (r: Rotation | undefined, by: number) => ((((r ?? 0) + by) % 360) + 360) % 360 as Rotation;

/** The copy of one node for a mirrored half (frames lose their children: their contents are copied as items too). */
function copyNode(n: LabelNode, mode: MirrorSpec["mode"], id: string): LabelNode {
  const c = (n.type === "frame" ? { ...n, children: [], mirror: undefined } : structuredClone(n)) as LabelNode;
  c.id = id;
  c.locked = true;
  if (mode === "rotate") {
    if (c.type === "polygon") c.angle = ((c.angle ?? 0) + 180) % 360;
    else if (c.type !== "frame") c.rotate = turn(c.rotate, 180);
  } else if (mode === "reflect") {
    if (c.type === "text") c.align = c.align === "left" ? "right" : c.align === "right" ? "left" : c.align;
    if (c.type === "line") c.direction = c.direction === "down" ? "up" : c.direction === "up" ? "down" : c.direction;
  }
  return c;
}

/** Id of a mirrored copy of `srcId` drawn inside the mirror frame `frameId`. */
export const mirrorCopyId = (frameId: string, srcId: string) => `${frameId}~${srcId}`;

/**
 * Add the copies for every mirrored frame to a laid-out item list (in paint
 * order, right after the mirror frame and its own subtree). Copies have
 * `copyOf` set to the source node id and are locked (the editor selects the
 * mirror frame instead).
 */
export function applyMirrors(items: LaidOut[], byId: Map<string, LaidOut>): LaidOut[] {
  if (!items.some((it) => it.node.type === "frame" && it.node.mirror)) return items;
  const out: LaidOut[] = [];
  const end = (i: number) => {
    let j = i + 1;
    while (j < items.length && items[j].depth > items[i].depth) j++;
    return j;
  };
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    out.push(it);
    const spec = it.node.type === "frame" ? it.node.mirror : undefined;
    if (!spec) continue;
    const si = items.findIndex((x) => x.node.id === spec.of);
    if (si < 0 || si === i) continue;
    const se = end(si);
    // Never copy a frame into itself or its own subtree.
    if (i > si && i < se) continue;
    const me = end(i);
    // Keep the mirror frame's own subtree (normally empty) before the copies.
    for (let k = i + 1; k < me; k++) out.push(items[k]);
    const src = items[si];
    const s = src.box, m = it.box;
    const offX = m.x + (m.w - s.w) / 2, offY = m.y + (m.h - s.h) / 2;
    for (let k = si + 1; k < se; k++) {
      const c = items[k];
      // Nested mirrors inside the source are not copied again.
      if (c.copyOf) continue;
      const dx = c.box.x - s.x, dy = c.box.y - s.y;
      const box: Box =
        spec.mode === "repeat"
          ? { x: offX + dx, y: offY + dy, w: c.box.w, h: c.box.h }
          : spec.mode === "reflect"
            ? { x: offX + (s.w - dx - c.box.w), y: offY + dy, w: c.box.w, h: c.box.h }
            : { x: offX + (s.w - dx - c.box.w), y: offY + (s.h - dy - c.box.h), w: c.box.w, h: c.box.h };
      const id = mirrorCopyId(it.node.id, c.node.id);
      const copy: LaidOut = { ...c, node: copyNode(c.node, spec.mode, id), box, depth: it.depth + (c.depth - src.depth), copyOf: c.node.id };
      out.push(copy);
      byId.set(id, copy);
    }
    i = me - 1;
  }
  return out;
}

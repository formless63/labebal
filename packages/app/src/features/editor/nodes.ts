"use client";
import { createElement } from "react";
import {
  IconBarcode,
  IconCircle,
  IconColumns,
  IconComponents,
  IconLayoutBoard,
  IconLayoutRows,
  IconHexagon,
  IconLine,
  IconPhoto,
  IconSquare,
  IconStar,
  IconTable,
  IconTypography,
  type Icon,
} from "@tabler/icons-react";
import { LABEL_FONT, getLibraryParts, newId, type FrameNode, type LabelNode, type NodeType } from "@labebal/core";

export type AddKind = Exclude<NodeType, "frame" | "component"> | "row" | "column" | "free";

export const ADD_ITEMS: { kind: AddKind; label: string; hint: string; icon: Icon }[] = [
  { kind: "text", label: "Text", hint: "Words, or a {{field}} filled in per label", icon: IconTypography },
  { kind: "rect", label: "Box", hint: "Filled or outlined rectangle", icon: IconSquare },
  { kind: "ellipse", label: "Circle", hint: "Circle or oval", icon: IconCircle },
  { kind: "line", label: "Line", hint: "Horizontal, vertical or diagonal line", icon: IconLine },
  { kind: "polygon", label: "Shape", hint: "Triangle, hexagon, star…", icon: IconHexagon },
  { kind: "image", label: "Picture", hint: "Uploaded image, printed in dots", icon: IconPhoto },
  { kind: "icon", label: "Icon", hint: "Symbol from the Tabler icon set", icon: IconStar },
  { kind: "code", label: "QR / barcode", hint: "QR code or barcode", icon: IconBarcode },
  { kind: "table", label: "Table", hint: "Rows and columns of text, e.g. a pinout or spec list", icon: IconTable },
  { kind: "row", label: "Row group", hint: "Lays its contents out side by side", icon: IconColumns },
  { kind: "column", label: "Column group", hint: "Stacks its contents top to bottom", icon: IconLayoutRows },
  { kind: "free", label: "Free group", hint: "Contents placed anywhere inside it", icon: IconLayoutBoard },
];

export function iconFor(n: LabelNode): Icon {
  if (n.type === "frame") return n.layout === "row" ? IconColumns : n.layout === "column" ? IconLayoutRows : IconLayoutBoard;
  if (n.type === "component") return IconComponents;
  return ADD_ITEMS.find((i) => i.kind === n.type)?.icon ?? IconSquare;
}

/** Type icon for a node (layers panel). */
export const NodeIcon = ({ node, className }: { node: LabelNode; className?: string }) => createElement(iconFor(node), { className });

export const TYPE_NAMES: Record<NodeType, string> = {
  frame: "Group",
  text: "Text",
  rect: "Box",
  ellipse: "Circle",
  line: "Line",
  polygon: "Shape",
  image: "Picture",
  icon: "Icon",
  code: "Code",
  table: "Table",
  component: "Component",
};

export function nodeLabel(n: LabelNode) {
  if (n.name) return n.name;
  if (n.type === "text") return n.text.split("\n")[0].slice(0, 24) || "Text";
  if (n.type === "frame") return n.layout === "row" ? "Row" : n.layout === "column" ? "Column" : "Group";
  // Instances show their component's name.
  if (n.type === "component") return getLibraryParts().components?.find((c) => c.id === n.ref)?.name ?? "Missing component";
  return TYPE_NAMES[n.type];
}

/** A new node with friendly defaults. `free` = parent places it freely (gets x/y and a fixed size). */
export function makeNode(kind: AddKind, opts: { free: boolean; x?: number; y?: number; font?: string; field?: string }): LabelNode {
  const pos = opts.free ? { x: opts.x ?? 1, y: opts.y ?? 1 } : {};
  const fixed = (w: number, h: number) => ({ w: { kind: "fixed" as const, mm: w }, h: { kind: "fixed" as const, mm: h } });
  switch (kind) {
    case "text":
      return {
        id: newId("text"),
        type: "text",
        text: opts.field ? `{{${opts.field}}}` : "Text",
        font: opts.font ?? LABEL_FONT,
        weight: 600,
        sizePt: 8,
        fit: "shrink",
        color: "black",
        w: { kind: "hug" },
        h: { kind: "hug" },
        ...pos,
      };
    case "rect":
      return { id: newId("rect"), type: "rect", fill: "black", ...fixed(6, 3), ...pos };
    case "ellipse":
      return { id: newId("ellipse"), type: "ellipse", fill: "none", stroke: "black", strokeMm: 0.3, ...fixed(4, 4), ...pos };
    case "polygon":
      return { id: newId("shape"), type: "polygon", sides: 6, fill: "black", ...fixed(5, 5), ...pos };
    case "line":
      return { id: newId("line"), type: "line", direction: "horizontal", color: "black", strokeMm: 0.3, ...fixed(8, 1), ...pos };
    case "image":
      return { id: newId("image"), type: "image", src: "", fit: "contain", dither: "atkinson", color: "black", ...fixed(6, 6), ...pos };
    case "icon":
      return { id: newId("icon"), type: "icon", icon: "star", color: "black", ...fixed(5, 5), ...pos };
    case "code":
      return { id: newId("code"), type: "code", format: "qrcode", value: opts.field ? `{{${opts.field}}}` : "https://example.com", ecc: "M", color: "black", ...fixed(8, 8), ...pos };
    case "table":
      return {
        id: newId("table"),
        type: "table",
        cols: [{ kind: "hug" }, { kind: "fill" }],
        rows: [{ kind: "fill" }, { kind: "fill" }, { kind: "fill" }],
        cells: [
          ["Pin", "Signal"],
          ["1", "Audio R"],
          ["2", "Audio L"],
        ],
        header: "row",
        font: opts.font ?? "Arial",
        sizePt: 6,
        fit: "shrink",
        color: "black",
        borderMm: 0.2,
        ...(opts.free ? fixed(20, 9) : { w: { kind: "fill" as const }, h: { kind: "fill" as const } }),
        ...pos,
      };
    default: {
      const frame: FrameNode = {
        id: newId("frame"),
        type: "frame",
        layout: kind,
        name: kind === "row" ? "Row" : kind === "column" ? "Column" : "Group",
        w: kind === "free" || opts.free ? { kind: "fixed", mm: 10 } : { kind: "hug" },
        h: kind === "free" || opts.free ? { kind: "fixed", mm: 6 } : { kind: "hug" },
        ...(kind !== "free" ? { gap: 0.5, align: "center" as const } : {}),
        children: [],
        ...pos,
      };
      return frame;
    }
  }
}

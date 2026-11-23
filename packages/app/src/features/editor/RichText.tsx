"use client";
/**
 * Rich text editing for text nodes: the content box plus a style bar that
 * applies bold / size / invert to the selected characters and inserts inline
 * icons. Styles are stored as `spans` over the raw text (core richtext.ts).
 */
import { useEffect, useRef, useState } from "react";
import { IconBold, IconClearFormatting, IconContrast2, IconTextSize } from "@tabler/icons-react";
import { adjustSpans, hasIconToken, applySpanStyle, iconToken, normalizeSpans, styleOfRange, type TextNode, type TextSpan } from "@labebal/core";
import { cn } from "../../lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Toggle } from "../../components/ui/toggle";
import { Tip } from "./controls";
import { BoundTextInput } from "./NodeProps";
import { IconPicker } from "./pickers";

const ICON_SPLIT = /(\{\{\s*icon:[^{}|\s]+\s*\}\})/g;
const ICON_WHOLE = /^\{\{\s*icon:[^{}|\s]+\s*\}\}$/;

type SetFn =(patch: Record<string, unknown>, key?: string) => void;

const SIZES = [
  { value: "0.6", label: "Small (60%)" },
  { value: "0.8", label: "Smaller (80%)" },
  { value: "1", label: "Normal" },
  { value: "1.25", label: "Larger (125%)" },
  { value: "1.5", label: "Large (150%)" },
  { value: "2", label: "Huge (200%)" },
];

export function RichTextInput({ node, set }: { node: TextNode; set: SetFn }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<[number, number]>([0, 0]);
  const area = () => wrap.current?.querySelector("textarea") ?? null;

  // Track the textarea selection (it survives clicks on the style buttons).
  useEffect(() => {
    const read = () => {
      const el = area();
      if (el && document.activeElement === el) setSel([el.selectionStart ?? 0, el.selectionEnd ?? 0]);
    };
    document.addEventListener("selectionchange", read);
    return () => document.removeEventListener("selectionchange", read);
  }, []);

  const [a, b] = sel[1] <= node.text.length ? sel : [node.text.length, node.text.length];
  const style = styleOfRange(node.spans, a, b);
  const hasSel = b > a;

  const apply = (key: "bold" | "invert" | "scale", value: boolean | number | undefined) => {
    if (!hasSel) return;
    const spans = applySpanStyle(normalizeSpans(node.text, node.spans), a, b, key, value);
    set({ spans }, `spans:${node.id}`);
    requestAnimationFrame(() => {
      const el = area();
      el?.focus();
      el?.setSelectionRange(a, b);
    });
  };

  const insertIcon = (id: string) => {
    const tok = iconToken(id);
    const text = node.text.slice(0, a) + tok + node.text.slice(b);
    set({ text, spans: adjustSpans(node.spans, node.text, text) }, `text:${node.id}`);
    requestAnimationFrame(() => {
      const el = area();
      el?.focus();
      el?.setSelectionRange(a + tok.length, a + tok.length);
    });
  };

  // Keep focus in the textarea when pressing style buttons.
  const keep = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className="space-y-1.5">
      <div ref={wrap}>
        <BoundTextInput
          label="Content"
          value={node.text}
          onChange={(text) => set({ text, spans: adjustSpans(node.spans, node.text, text) }, `text:${node.id}`)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Text style for the selected characters">
        <Tip tip={hasSel ? "Bold (selected text)" : "Select some text first"}>
          <Toggle size="sm" className="h-7 w-7" pressed={!!style.bold} disabled={!hasSel} onMouseDown={keep} onPressedChange={(v) => apply("bold", v || undefined)} aria-label="Bold">
            <IconBold />
          </Toggle>
        </Tip>
        <Tip tip={hasSel ? "White on black (selected text)" : "Select some text first"}>
          <Toggle size="sm" className="h-7 w-7" pressed={!!style.invert} disabled={!hasSel} onMouseDown={keep} onPressedChange={(v) => apply("invert", v || undefined)} aria-label="Invert">
            <IconContrast2 />
          </Toggle>
        </Tip>
        <Select value={String(style.scale ?? 1)} disabled={!hasSel} onValueChange={(v) => apply("scale", Number(v) === 1 ? undefined : Number(v))}>
          <SelectTrigger size="sm" className="h-7 w-32 text-xs" aria-label="Size of the selected text">
            <IconTextSize className="size-3.5" aria-hidden />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SIZES.map((s) => (
              <SelectItem key={s.value} value={s.value} className="text-xs">
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Tip tip="Insert an icon into the text at the cursor">
          <span>
            <IconPicker compact value="" onChange={insertIcon} />
          </span>
        </Tip>
        {!!node.spans?.length && (
          <Tip tip="Remove all text styles">
            <button className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" onMouseDown={keep} onClick={() => set({ spans: undefined }, `spans:${node.id}`)} aria-label="Clear text styles">
              <IconClearFormatting className="size-4" />
            </button>
          </Tip>
        )}
      </div>
      {(!!node.spans?.length || hasIconToken(node.text)) && <StyledPreview text={node.text} spans={node.spans} />}
    </div>
  );
}

/** The raw text with its styles shown (bold, size, inverted runs, icon chips). */
function StyledPreview({ text, spans }: { text: string; spans?: TextSpan[] }) {
  const ss = normalizeSpans(text, spans);
  const cuts = [...new Set([0, text.length, ...ss.flatMap((s) => [s.start, s.end])])].sort((x, y) => x - y);
  const parts: React.ReactNode[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [a, b] = [cuts[i], cuts[i + 1]];
    const st = styleOfRange(ss, a, b);
    const seg = text.slice(a, b);
    const bits = seg.split(ICON_SPLIT);
    parts.push(
      <span
        key={a}
        className={cn(st.bold && "font-bold", st.invert && "bg-foreground text-background")}
        style={st.scale && st.scale !== 1 ? { fontSize: `${Math.round(st.scale * 100)}%` } : undefined}
      >
        {bits.map((x, j) =>
          ICON_WHOLE.test(x) ? (
            <span key={j} className="mx-0.5 rounded bg-sky-500/15 px-1 font-mono text-[10px] text-sky-700 dark:text-sky-300">
              {x.replace(/^\{\{\s*icon:|\s*\}\}$/g, "")}
            </span>
          ) : (
            x
          ),
        )}
      </span>,
    );
  }
  return (
    <p className="rounded-md border bg-muted/40 p-1.5 text-xs whitespace-pre-wrap" aria-label="Styled text preview">
      {parts}
    </p>
  );
}

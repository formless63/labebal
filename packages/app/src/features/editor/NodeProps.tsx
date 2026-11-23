"use client";
/** Property panel for the selected element (all schema fields, by node type). */
import { useEffect, useRef } from "react";
import {
  IconAlignCenter,
  IconAlignJustified,
  IconAlignLeft,
  IconAlignRight,
  IconArrowBackUp,
  IconEye,
  IconEyeOff,
  IconLayoutAlignBottom,
  IconLayoutAlignMiddle,
  IconLayoutAlignTop,
  IconLock,
  IconLockOpen,
  IconPlus,
} from "@tabler/icons-react";
import {
  BUILTIN_FONTS,
  SYSTEM_FONTS,
  TEXT_STYLE_KEYS,
  applyTextStyle,
  effectiveNode,
  findParent,
  isBuiltinFont,
  variantsShowing,
  is2d,
  type FontDef,
  type FrameNode,
  type LabelNode,
  type Rotation,
  type TextNode,
} from "@labebal/core";
import { Button } from "../../components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Slider } from "../../components/ui/slider";
import { Textarea } from "../../components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { useFonts } from "../fonts/fonts-client";
import { CableSection } from "./CableProps";
import { CodeFormatField, CodeValueCheck, eccOptions } from "./CodeProps";
import { useLabelStore } from "../labels/store";
import {
  AnchorWidget,
  ChoiceField,
  Field,
  IconBtn,
  NumField,
  NumInput,
  PaintField,
  Row,
  Section,
  SizeRuleEditor,
  SizingField,
  SwitchField,
  Tip,
  ruleSummary,
} from "./controls";
import { getGeo } from "./geometry";
import { TYPE_NAMES, nodeLabel } from "./nodes";
import { IconPicker, ImagePicker } from "./pickers";
import { RichTextInput } from "./RichText";
import { makeFree, setFloat } from "./ops";
import { TableSection } from "./TableProps";
import { updateProps, useEditor, visibilityPatch, writeProps } from "./store";
import { useLibrary } from "../labels/api";
import { InstanceSection, TextStyleField } from "./PartsProps";

const TOKENS = [
  { token: "{{date}}", label: "Today's date" },
  { token: "{{date:DD/MM/YYYY}}", label: "Date (day/month/year)" },
  { token: "{{time}}", label: "Time" },
  { token: "{{seq}}", label: "Counter (1, 2, 3…)" },
  { token: "{{seq:000}}", label: "Counter (001, 002…)" },
  { token: "{{copy}}/{{copies}}", label: "Copy number (1/5)" },
];

/** Links: a QR of {{labelUrl}} opens the label's page (/l/<id>); {{recordUrl}} needs the template's record link. */
const linkTokens = (t: { recordUrl?: string }) => [
  { token: "{{labelUrl}}", label: "Link to this label's page" },
  ...(t.recordUrl?.trim() ? [{ token: "{{recordUrl}}", label: "Link to the record (inventory)" }] : []),
];

export function NodeProps({ id }: { id: string }) {
  const t = useEditor((s) => s.template)!;
  const variantId = useEditor((s) => s.variantId);
  const node = effectiveNode(t, id, variantId);
  if (!node) return null;
  const parentBase = findParent(t.root, id);
  const parent = parentBase ? (effectiveNode(t, parentBase.id, variantId) as FrameNode) : null;
  const variant = variantId ? t.variants?.find((v) => v.id === variantId) : undefined;
  const showing = variantsShowing(t, id);
  // "Only in this variant" (hidden: false over a hidden base) is structure, not a setting to reset.
  const overridden = Object.keys(variant?.patches[id] ?? {}).filter((k) => !(k === "hidden" && variant && showing.includes(variant.id)));
  const set = (patch: Record<string, unknown>, key?: string) => updateProps(id, patch, key);
  // Names and locks are editor aids: always on the base node, never per variant.
  const setBase = (patch: Record<string, unknown>, key?: string) => useEditor.getState().commit((x) => writeProps(x, id, patch, null), key);
  const box = getGeo()?.actual.byId.get(id)?.box;

  return (
    <div>
      <div className="space-y-2 border-b px-3 py-2.5">
        <div className="flex items-center gap-1">
          <Input className="h-7 flex-1 text-sm font-medium" value={node.name ?? ""} placeholder={nodeLabel(node)} onChange={(e) => setBase({ name: e.target.value || undefined }, `name:${id}`)} aria-label="Element name" />
          <IconBtn
            tip={node.hidden ? "Hidden: click to show" : variant ? `Hide on “${variant.name}” sizes` : "Hide"}
            onClick={() => set(visibilityPatch(t, id, !node.hidden, variantId))}
          >
            {node.hidden ? <IconEyeOff /> : <IconEye />}
          </IconBtn>
          <IconBtn tip={node.locked ? "Locked: click to unlock" : "Lock (can't be selected or moved on the label)"} onClick={() => setBase({ locked: node.locked ? undefined : true })}>
            {node.locked ? <IconLock /> : <IconLockOpen />}
          </IconBtn>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {TYPE_NAMES[node.type]}
          {node.type === "frame" && ` · ${node.layout === "free" ? "free placement" : node.layout === "row" ? "side by side" : "top to bottom"}`}
          {box && ` · ${box.w.toFixed(1)} × ${box.h.toFixed(1)} mm here`}
        </p>
        {showing.length > 0 && (
          <p className="rounded-md bg-amber-500/10 p-2 text-[11px] text-amber-800 dark:text-amber-300">
            Only shown by the variant{showing.length > 1 ? "s" : ""} {showing.map((v) => `“${t.variants?.find((x) => x.id === v)?.name ?? v}”`).join(", ")}.
            {!variant && " Show it here to use it on every size."}
          </p>
        )}
        {variant && overridden.length > 0 && (
          <div className="rounded-md bg-amber-500/10 p-2 text-[11px]">
            <p className="mb-1 text-amber-800 dark:text-amber-300">Changed in &ldquo;{variant.name}&rdquo;: {overridden.join(", ")}</p>
            <Button size="xs" variant="outline" onClick={() => set(Object.fromEntries(overridden.map((k) => [k, undefined])), `reset:${id}`)}>
              <IconArrowBackUp /> Use the normal settings
            </Button>
          </div>
        )}
      </div>

      {node.type === "text" && <StyledTextSection node={node} set={set} />}
      {node.type === "component" && <InstanceSection node={node} />}
      {node.type === "image" && <ImageSection node={node} set={set} />}
      {node.type === "icon" && <IconSection node={node} set={set} />}
      {node.type === "code" && <CodeSection node={node} set={set} />}
      {node.type === "frame" && <FrameSection node={node} set={set} isRoot={id === t.root.id} />}
      {node.type === "frame" && <CableSection node={node} set={set} isRoot={id === t.root.id} />}
      {(node.type === "rect" || node.type === "ellipse") && <ShapeSection node={node} set={set} />}
      {node.type === "line" && <LineSection node={node} set={set} />}
      {node.type === "polygon" && <PolygonSection node={node} set={set} />}
      {node.type === "table" && <TableSection node={node} set={set} />}

      <Section title="Size & position">
        <SizingField
          label="Width"
          sizing={node.w}
          natural={box?.w}
          min={node.minW}
          max={node.maxW}
          onChange={(w) => set({ w })}
          onLimits={(minW, maxW) => set({ minW, maxW }, `limits-w:${id}`)}
        />
        <SizingField
          label="Height"
          sizing={node.h}
          natural={box?.h}
          min={node.minH}
          max={node.maxH}
          onChange={(h) => set({ h })}
          onLimits={(minH, maxH) => set({ minH, maxH }, `limits-h:${id}`)}
        />
        {parent && parent.layout !== "free" && (
          <SwitchField
            label="Float freely"
            hint={`Take it out of the ${parent.layout === "row" ? "row" : "column"}: it stays where you put it and the rest lines up without it. Drag it anywhere.`}
            checked={!!node.float}
            onChange={(on) => setFloat([id], on)}
          />
        )}
        {(parent?.layout === "free" || node.float) && (
          <>
            <Row>
              <NumField label="X" hint="Distance from the group's left edge, at the design size." unit="mm" value={node.x ?? 0} onChange={(v) => set({ x: v ?? 0 }, `x:${id}`)} />
              <NumField label="Y" hint="Distance from the group's top edge, at the design size." unit="mm" value={node.y ?? 0} onChange={(v) => set({ y: v ?? 0 }, `y:${id}`)} />
            </Row>
            <AnchorWidget ax={node.ax} ay={node.ay} onChange={(ax, ay) => set({ ax: ax === "start" ? undefined : ax, ay: ay === "start" ? undefined : ay })} />
          </>
        )}
        {parent && parent.layout !== "free" && !node.float && (
          <ChoiceField
            label={parent.layout === "row" ? "Vertical position in row" : "Horizontal position in column"}
            hint="Overrides the group's alignment for this element only."
            value={node.alignSelf ?? "auto"}
            onChange={(v) => set({ alignSelf: v === "auto" ? undefined : v })}
            options={[
              { value: "auto", label: "Same as group" },
              { value: "start", label: parent.layout === "row" ? "Top" : "Left" },
              { value: "center", label: "Center" },
              { value: "end", label: parent.layout === "row" ? "Bottom" : "Right" },
              { value: "stretch", label: "Stretch" },
            ]}
          />
        )}
        <Field label="Rotation" hint="Turns the element. Text reads bottom-to-top at 270°.">
          <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={String(node.rotate ?? 0)} onValueChange={(v) => v && set({ rotate: v === "0" ? undefined : (Number(v) as Rotation) })}>
            {[0, 90, 180, 270].map((r) => (
              <ToggleGroupItem key={r} value={String(r)} className="text-xs" aria-label={`${r} degrees`}>
                {r}°
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
      </Section>

      <Section title="Show on sizes" defaultOpen={!!node.showWhen}>
        <SwitchField
          label="Only on some label sizes"
          hint="Hide this element on labels that are too small or the wrong shape."
          checked={!!node.showWhen}
          onChange={(on) => set({ showWhen: on ? { maxW: 30 } : undefined })}
        />
        {node.showWhen && (
          <>
            <p className="text-[11px] text-muted-foreground">Shown when {ruleSummary(node.showWhen)}.</p>
            <ShowWhen id={id} rule={node.showWhen} />
          </>
        )}
      </Section>
    </div>
  );
}

function ShowWhen({ id, rule }: { id: string; rule: NonNullable<LabelNode["showWhen"]> }) {
  const marginMm = useLabelStore((s) => s.settings.marginMm);
  return <SizeRuleEditor rule={rule} marginMm={marginMm} onChange={(r) => updateProps(id, { showWhen: r }, `showWhen:${id}`)} />;
}

type SetFn = (patch: Record<string, unknown>, key?: string) => void;

/* ----------------------------------------------------------------- text */

/** Textarea with "insert field / token" menu; focuses on canvas double-click. */
export function BoundTextInput({ value, onChange, multiline = true, label }: { value: string; onChange: (v: string) => void; multiline?: boolean; label: string }) {
  const teamValues = useLabelStore((s) => s.settings.teamValues) ?? {};
  const t = useEditor((s) => s.template)!;
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  useEffect(() => {
    const focus = () => ref.current?.focus();
    window.addEventListener("editor:focus-content", focus);
    return () => window.removeEventListener("editor:focus-content", focus);
  }, []);
  const insert = (s: string) => {
    const el = ref.current;
    const [a, b] = el ? [el.selectionStart ?? value.length, el.selectionEnd ?? value.length] : [value.length, value.length];
    onChange(value.slice(0, a) + s + value.slice(b));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(a + s.length, a + s.length);
    });
  };
  return (
    <Field label={label} hint="Type fixed text, or insert a field: {{name}} is replaced by each label's value.">
      {multiline ? (
        <Textarea ref={ref} rows={2} className="min-h-0 text-sm" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
      ) : (
        <Input ref={ref} className="h-7 text-sm" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="xs" className="text-muted-foreground">
            <IconPlus /> Insert field
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Fields</DropdownMenuLabel>
          {t.fields.map((f) => (
            <DropdownMenuItem key={f.key} onSelect={() => insert(`{{${f.key}}}`)}>
              {f.label} <span className="ml-auto font-mono text-[10px] text-muted-foreground">{`{{${f.key}}}`}</span>
            </DropdownMenuItem>
          ))}
          {!t.fields.length && <DropdownMenuItem disabled>No fields yet (add them under Fields)</DropdownMenuItem>}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Automatic</DropdownMenuLabel>
          {TOKENS.map((k) => (
            <DropdownMenuItem key={k.token} onSelect={() => insert(k.token)}>
              {k.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Team values (Settings)</DropdownMenuLabel>
          {Object.keys(teamValues).sort().map((k) => (
            <DropdownMenuItem key={k} onSelect={() => insert(`{{team:${k}}}`)}>
              <span className="max-w-40 truncate">{teamValues[k] || k}</span> <span className="ml-auto font-mono text-[10px] text-muted-foreground">{`{{team:${k}}}`}</span>
            </DropdownMenuItem>
          ))}
          {!Object.keys(teamValues).length && <DropdownMenuItem disabled>None yet (Settings &gt; Team values)</DropdownMenuItem>}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Links (for QR codes)</DropdownMenuLabel>
          {linkTokens(t).map((k) => (
            <DropdownMenuItem key={k.token} onSelect={() => insert(k.token)}>
              {k.label} <span className="ml-auto font-mono text-[10px] text-muted-foreground">{k.token}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </Field>
  );
}

export function FontPicker({ value, onChange }: { value: string; onChange: (f: string) => void }) {
  const fonts = useFonts();
  const known = fonts.some((f) => f.family === value) || SYSTEM_FONTS.includes(value);
  const builtin = fonts.filter((f) => BUILTIN_FONTS.some((b) => b.family === f.family && b.url === f.url));
  const uploaded = fonts.filter((f) => !builtin.includes(f));
  const item = (f: FontDef, note?: string) => (
    <SelectItem key={f.family} value={f.family} className="text-xs">
      <span style={{ fontFamily: `"${f.family}"` }}>{f.family}</span>
      {note && <span className="ml-1 text-[10px] text-muted-foreground">{note}</span>}
    </SelectItem>
  );
  return (
    <Field label="Font" hint="Pixel fonts print crisply at their native sizes; other fonts are smoothed to dots. Upload your own under Settings.">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger size="sm" className="h-7 w-full text-xs" aria-label="Font">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Built-in pixel fonts</SelectLabel>
            {builtin.map((f) => item(f))}
          </SelectGroup>
          {uploaded.length > 0 && (
            <SelectGroup>
              <SelectLabel>Uploaded</SelectLabel>
              {uploaded.map((f) => item(f, isBuiltinFont(f.family) ? "replaces built-in" : f.pixel ? "pixel" : undefined))}
            </SelectGroup>
          )}
          <SelectGroup>
            <SelectLabel>Smooth fonts</SelectLabel>
            {SYSTEM_FONTS.map((f) => (
              <SelectItem key={f} value={f} className="text-xs">
                <span style={{ fontFamily: f }}>{f}</span>
              </SelectItem>
            ))}
            {!known && value && (
              <SelectItem value={value} className="text-xs">
                {value}
              </SelectItem>
            )}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}

/**
 * Text properties as they look with the text's style applied. Changing a
 * style property on a styled text (outside variants) records it as this
 * text's own override, so the style no longer changes it.
 */
function StyledTextSection({ node, set }: { node: TextNode; set: SetFn }) {
  const { data: lib } = useLibrary();
  const variantId = useEditor((s) => s.variantId);
  const shown = node.style ? applyTextStyle(node, lib?.styles) : node;
  const styled = !!node.style && shown !== node;
  const setStyled: SetFn = (patch, key) => {
    const keys = Object.keys(patch).filter((k) => (TEXT_STYLE_KEYS as readonly string[]).includes(k));
    if (!styled || variantId || !keys.length) return set(patch, key);
    const own = [...new Set([...(node.styleOverrides ?? []), ...keys])] as TextNode["styleOverrides"];
    set({ ...patch, styleOverrides: own }, key ?? `props:${node.id}:${Object.keys(patch).join(",")}`);
  };
  return <TextSection node={shown} set={setStyled} />;
}

function TextSection({ node, set }: { node: TextNode; set: SetFn }) {
  const id = node.id;
  return (
    <>
      <Section title="Text">
        <RichTextInput node={node} set={set} />
        <TextStyleField node={node} />
        <FontPicker value={node.font} onChange={(font) => set({ font })} />
        <Row>
          <NumField label="Size" hint="Preferred size in points at the design size." unit="pt" min={1} max={200} step={0.5} value={node.sizePt} onChange={(v) => v && set({ sizePt: v }, `size:${id}`)} />
          <NumField label="Smallest size" hint="When shrinking to fit, never go below this." unit="pt" min={0} allowEmpty placeholder="none" value={node.minSizePt} onChange={(v) => set({ minSizePt: v }, `minsize:${id}`)} />
        </Row>
        <ChoiceField
          label="Fit to box"
          hint="Shrink: gets smaller when it doesn't fit. Fill: grows or shrinks to fill the box. Fixed: always the set size."
          value={node.fit ?? "shrink"}
          onChange={(fit) => set({ fit: fit === "shrink" ? undefined : fit })}
          options={[
            { value: "shrink", label: "Shrink to fit" },
            { value: "fill", label: "Fill the box" },
            { value: "fixed", label: "Fixed size" },
          ]}
        />
        <div className="flex gap-2">
          <Field label="Align">
            <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={node.align ?? "left"} onValueChange={(v) => v && set({ align: v === "left" ? undefined : v })}>
              <Tip tip="Left">
                <ToggleGroupItem value="left" aria-label="Align left">
                  <IconAlignLeft />
                </ToggleGroupItem>
              </Tip>
              <Tip tip="Center">
                <ToggleGroupItem value="center" aria-label="Align center">
                  <IconAlignCenter />
                </ToggleGroupItem>
              </Tip>
              <Tip tip="Right">
                <ToggleGroupItem value="right" aria-label="Align right">
                  <IconAlignRight />
                </ToggleGroupItem>
              </Tip>
              <Tip tip="Justify: spread letters across the box">
                <ToggleGroupItem value="justify" aria-label="Justify">
                  <IconAlignJustified />
                </ToggleGroupItem>
              </Tip>
            </ToggleGroup>
          </Field>
          <Field label="Vertical">
            <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={node.valign ?? "top"} onValueChange={(v) => v && set({ valign: v === "top" ? undefined : v })}>
              <Tip tip="Top">
                <ToggleGroupItem value="top" aria-label="Top">
                  <IconLayoutAlignTop />
                </ToggleGroupItem>
              </Tip>
              <Tip tip="Middle">
                <ToggleGroupItem value="middle" aria-label="Middle">
                  <IconLayoutAlignMiddle />
                </ToggleGroupItem>
              </Tip>
              <Tip tip="Bottom">
                <ToggleGroupItem value="bottom" aria-label="Bottom">
                  <IconLayoutAlignBottom />
                </ToggleGroupItem>
              </Tip>
            </ToggleGroup>
          </Field>
        </div>
        <Row>
          <NumField label="Letter spacing" unit="mm" step={0.05} allowEmpty placeholder="0" value={node.letterSpacing} onChange={(v) => set({ letterSpacing: v || undefined }, `ls:${id}`)} />
          <NumField label="Line height" hint="Multiple of the text size (smooth fonts)." step={0.05} min={0.5} allowEmpty placeholder="1.1" value={node.lineHeight} onChange={(v) => set({ lineHeight: v }, `lh:${id}`)} />
        </Row>
        <Row>
          <NumField label="Weight" hint="Boldness for smooth fonts: 400 normal, 700 bold." step={100} min={100} max={900} allowEmpty placeholder="400" value={node.weight} onChange={(v) => set({ weight: v }, `weight:${id}`)} />
          <div className="flex items-end pb-1.5">
            <SwitchField label="CAPITALS" checked={!!node.uppercase} onChange={(v) => set({ uppercase: v || undefined })} />
          </div>
        </Row>
      </Section>
      <Section title="Color">
        <PaintField label="Text" value={node.color} onChange={(color) => set({ color })} allowNone={false} />
        <Row>
          <PaintField label="Outline" hint="Draws a line around each letter, e.g. white outline on a black box." value={node.stroke} onChange={(stroke) => set({ stroke: stroke === "none" ? undefined : stroke, strokeMm: stroke === "none" ? undefined : (node.strokeMm ?? 0.15) })} />
          {node.stroke && node.stroke !== "none" && <NumField label="Outline width" unit="mm" step={0.05} min={0} value={node.strokeMm} onChange={(v) => set({ strokeMm: v }, `sw:${id}`)} />}
        </Row>
      </Section>
    </>
  );
}

/* --------------------------------------------------------------- others */

function ShapeSection({ node, set }: { node: Extract<LabelNode, { type: "rect" | "ellipse" }>; set: SetFn }) {
  return (
    <Section title="Look">
      <PaintField label="Fill" value={node.fill} onChange={(fill) => set({ fill })} />
      <Row>
        <PaintField label="Border" value={node.stroke} onChange={(stroke) => set({ stroke: stroke === "none" ? undefined : stroke, strokeMm: stroke === "none" ? undefined : (node.strokeMm ?? 0.3) })} />
        {node.stroke && node.stroke !== "none" && <NumField label="Border width" unit="mm" step={0.05} min={0} value={node.strokeMm} onChange={(v) => set({ strokeMm: v }, `sw:${node.id}`)} />}
      </Row>
      {node.type === "rect" && <NumField label="Corner radius" unit="mm" step={0.1} min={0} allowEmpty placeholder="0" value={node.radius} onChange={(v) => set({ radius: v || undefined }, `radius:${node.id}`)} />}
    </Section>
  );
}

function PolygonSection({ node, set }: { node: Extract<LabelNode, { type: "polygon" }>; set: SetFn }) {
  return (
    <Section title="Shape">
      <Row>
        <NumField label={node.star ? "Points" : "Corners"} step={1} min={3} max={24} value={node.sides} onChange={(v) => v && set({ sides: Math.round(v) }, `sides:${node.id}`)} />
        <NumField label="Turn" hint="Rotate the shape inside its box." unit="°" step={15} value={node.angle ?? 0} onChange={(v) => set({ angle: v || undefined }, `angle:${node.id}`)} />
      </Row>
      <ChoiceField
        label="Style"
        value={node.star ? "star" : "polygon"}
        onChange={(v) => set({ star: v === "star" || undefined })}
        options={[
          { value: "polygon", label: "Polygon" },
          { value: "star", label: "Star" },
        ]}
      />
      {node.star && (
        <NumField label="Inner size" hint="How deep the star points are (0.1 = spiky, 0.9 = nearly round)." step={0.05} min={0.1} max={0.95} value={node.innerRatio ?? 0.45} onChange={(v) => v && set({ innerRatio: v }, `inner:${node.id}`)} />
      )}
      <PaintField label="Fill" value={node.fill} onChange={(fill) => set({ fill })} />
      <Row>
        <PaintField label="Border" value={node.stroke} onChange={(stroke) => set({ stroke: stroke === "none" ? undefined : stroke, strokeMm: stroke === "none" ? undefined : (node.strokeMm ?? 0.3) })} />
        {node.stroke && node.stroke !== "none" && <NumField label="Border width" unit="mm" step={0.05} min={0} value={node.strokeMm} onChange={(v) => set({ strokeMm: v }, `sw:${node.id}`)} />}
      </Row>
    </Section>
  );
}

function LineSection({ node, set }: { node: Extract<LabelNode, { type: "line" }>; set: SetFn }) {
  return (
    <Section title="Line">
      <ChoiceField
        label="Direction"
        value={node.direction}
        onChange={(direction) => set({ direction })}
        options={[
          { value: "horizontal", label: "Horizontal ─" },
          { value: "vertical", label: "Vertical │" },
          { value: "down", label: "Diagonal ╲" },
          { value: "up", label: "Diagonal ╱" },
        ]}
      />
      <PaintField label="Color" value={node.color} onChange={(color) => set({ color })} allowNone={false} />
      <Row>
        <NumField label="Thickness" unit="mm" step={0.05} min={0.05} value={node.strokeMm} onChange={(v) => v && set({ strokeMm: v }, `sw:${node.id}`)} />
        <NumField label="Dashes" hint="Dash length; empty for a solid line." unit="mm" step={0.1} min={0} allowEmpty placeholder="solid" value={node.dashMm} onChange={(v) => set({ dashMm: v || undefined }, `dash:${node.id}`)} />
      </Row>
    </Section>
  );
}

function ImageSection({ node, set }: { node: Extract<LabelNode, { type: "image" }>; set: SetFn }) {
  const threshold = node.threshold ?? 128;
  return (
    <Section title="Picture">
      <ImagePicker value={node.src} onChange={(src) => set({ src })} />
      <BoundTextInput label="Or picture address / field" multiline={false} value={node.src} onChange={(src) => set({ src }, `src:${node.id}`)} />
      <ChoiceField
        label="Fit"
        value={node.fit}
        onChange={(fit) => set({ fit })}
        options={[
          { value: "contain", label: "Whole picture (fit inside)" },
          { value: "cover", label: "Fill the box (crop)" },
          { value: "stretch", label: "Stretch" },
        ]}
      />
      <ChoiceField
        label="Dots style"
        hint="How shades of gray become dots. Atkinson / Floyd-Steinberg keep detail in photos; Threshold is best for logos and line art."
        value={node.dither}
        onChange={(dither) => set({ dither })}
        options={[
          { value: "threshold", label: "Threshold (logos, line art)" },
          { value: "atkinson", label: "Atkinson (photos, crisp)" },
          { value: "floyd-steinberg", label: "Floyd-Steinberg (photos, smooth)" },
          { value: "ordered", label: "Ordered pattern" },
        ]}
      />
      <Field label={`Darkness cut-off: ${threshold}`} hint="Pixels darker than this print. Raise it to print more, lower to print less.">
        <Slider min={0} max={255} step={1} value={[threshold]} onValueChange={([v]) => set({ threshold: v === 128 ? undefined : v }, `thr:${node.id}`)} />
      </Field>
      <SwitchField label="Invert picture" checked={!!node.invertImage} onChange={(v) => set({ invertImage: v || undefined })} />
      <PaintField label="Dots" value={node.color} onChange={(color) => set({ color })} allowNone={false} />
    </Section>
  );
}

function IconSection({ node, set }: { node: Extract<LabelNode, { type: "icon" }>; set: SetFn }) {
  return (
    <Section title="Icon">
      <IconPicker value={node.icon} filled={node.filled} onChange={(icon) => set({ icon })} />
      <BoundTextInput label="Or icon name / field" multiline={false} value={node.icon} onChange={(icon) => set({ icon }, `icon:${node.id}`)} />
      <SwitchField label="Filled version" hint="Use the solid variant when the icon has one." checked={!!node.filled} onChange={(v) => set({ filled: v || undefined })} />
      <NumField label="Line thickness" hint="Empty = scales with the icon size." unit="mm" step={0.05} min={0} allowEmpty placeholder="auto" value={node.strokeMm} onChange={(v) => set({ strokeMm: v }, `sw:${node.id}`)} />
      <PaintField label="Color" value={node.color} onChange={(color) => set({ color })} allowNone={false} />
    </Section>
  );
}

function CodeSection({ node, set }: { node: Extract<LabelNode, { type: "code" }>; set: SetFn }) {
  const twoD = is2d(node.format);
  return (
    <Section title="Code">
      <CodeFormatField value={node.format} onChange={(format) => set({ format })} />
      <BoundTextInput label="Contents" multiline={node.format === "swissqr" || node.value.includes("\n")} value={node.value} onChange={(value) => set({ value }, `value:${node.id}`)} />
      <CodeValueCheck node={node} />
      {eccOptions(node.format).length > 0 && (
        <ChoiceField
          label="Error correction"
          hint="Higher survives scratches better but needs more dots."
          value={eccOptions(node.format).some((o) => o.value === node.ecc) ? node.ecc : "M"}
          onChange={(ecc) => set({ ecc })}
          options={eccOptions(node.format)}
        />
      )}
      {!twoD && <SwitchField label="Show text under barcode" checked={!!node.showText} onChange={(v) => set({ showText: v || undefined })} />}
      <SwitchField
        label="Blank margin (quiet zone)"
        hint="Keeps the standard empty border around the code so scanners find it more easily. Makes the code a little smaller."
        checked={!!node.quietZone}
        onChange={(v) => set({ quietZone: v || undefined })}
      />

      <PaintField label="Color" value={node.color} onChange={(color) => set({ color })} allowNone={false} />
    </Section>
  );
}

function FrameSection({ node, set, isRoot }: { node: FrameNode; set: SetFn; isRoot: boolean }) {
  const id = node.id;
  const [pt, pr, pb, pl] = node.padding ?? [0, 0, 0, 0];
  const pad = (i: number, v: number | undefined) => {
    const p = [...(node.padding ?? [0, 0, 0, 0])] as [number, number, number, number];
    p[i] = v ?? 0;
    set({ padding: p.every((x) => !x) ? undefined : p }, `pad:${id}`);
  };
  const row = node.layout === "row";
  return (
    <>
      <Section title={isRoot ? "Label layout" : "Group layout"}>
        <ChoiceField
          label="Arrange contents"
          hint="Side by side / top to bottom reflow automatically on every label size. Free placement lets you put things anywhere and pin them to edges."
          value={node.layout}
          onChange={(layout) => (layout === "free" ? makeFree(id) : set({ layout }))}
          options={[
            { value: "row", label: "Side by side (row)" },
            { value: "column", label: "Top to bottom (column)" },
            { value: "free", label: "Free placement" },
          ]}
        />
        {node.layout !== "free" && (
          <>
            <NumField label="Gap between items" unit="mm" step={0.1} min={0} value={node.gap ?? 0} onChange={(v) => set({ gap: v || undefined }, `gap:${id}`)} />
            <Row>
              <ChoiceField
                label={row ? "Vertical alignment" : "Horizontal alignment"}
                value={node.align ?? "start"}
                onChange={(align) => set({ align: align === "start" ? undefined : align })}
                options={[
                  { value: "start", label: row ? "Top" : "Left" },
                  { value: "center", label: "Center" },
                  { value: "end", label: row ? "Bottom" : "Right" },
                  { value: "stretch", label: "Stretch" },
                ]}
              />
              <ChoiceField
                label={row ? "Horizontal spread" : "Vertical spread"}
                hint="Where items sit along the row/column when there's spare room."
                value={node.justify ?? "start"}
                onChange={(justify) => set({ justify: justify === "start" ? undefined : justify })}
                options={[
                  { value: "start", label: row ? "Left" : "Top" },
                  { value: "center", label: "Center" },
                  { value: "end", label: row ? "Right" : "Bottom" },
                  { value: "between", label: "Spread out" },
                  { value: "around", label: "Even space around" },
                ]}
              />
            </Row>
          </>
        )}
        <Field label="Inner padding" hint="Space between the group's edge and its contents (top, right, bottom, left).">
          <div className="grid grid-cols-4 gap-1">
            <NumInput value={pt} unit="↑" step={0.1} min={0} onChange={(v) => pad(0, v)} ariaLabel="Padding top" />
            <NumInput value={pr} unit="→" step={0.1} min={0} onChange={(v) => pad(1, v)} ariaLabel="Padding right" />
            <NumInput value={pb} unit="↓" step={0.1} min={0} onChange={(v) => pad(2, v)} ariaLabel="Padding bottom" />
            <NumInput value={pl} unit="←" step={0.1} min={0} onChange={(v) => pad(3, v)} ariaLabel="Padding left" />
          </div>
        </Field>
        <SwitchField label="Clip contents" hint="Cut off anything that spills outside the group." checked={!!node.clip} onChange={(v) => set({ clip: v || undefined })} />
      </Section>
      <Section title="Background" defaultOpen={!!node.fill || !!node.stroke}>
        <PaintField label="Fill" value={node.fill} onChange={(fill) => set({ fill: fill === "none" ? undefined : fill })} />
        <Row>
          <PaintField label="Border" value={node.stroke} onChange={(stroke) => set({ stroke: stroke === "none" ? undefined : stroke, strokeMm: stroke === "none" ? undefined : (node.strokeMm ?? 0.3) })} />
          {node.stroke && node.stroke !== "none" && <NumField label="Border width" unit="mm" step={0.05} min={0} value={node.strokeMm} onChange={(v) => set({ strokeMm: v }, `sw:${id}`)} />}
        </Row>
        <NumField label="Corner radius" unit="mm" step={0.1} min={0} allowEmpty placeholder="0" value={node.radius} onChange={(v) => set({ radius: v || undefined }, `radius:${id}`)} />
      </Section>
    </>
  );
}

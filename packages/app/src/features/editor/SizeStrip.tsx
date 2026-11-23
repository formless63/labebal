"use client";
/**
 * Reflow check: the template on the stock sizes it suits (closest shape and
 * size to its design first), every size on request. Click one to edit at that size.
 */
import { IconStack2 } from "@tabler/icons-react";
import { useState } from "react";
import { GOOD_FIT, SIZES, matchesRule, sizeFit, sizePrinterName, type Label, type Template } from "@labebal/core";
import { cn } from "../../lib/utils";
import { useLabelStore } from "../labels/store";
import { TemplateThumb } from "../templates/TemplateThumb";
import { Tip } from "./controls";
import { makeView } from "./geometry";
import { useEditorView } from "./store";

export function SizeStrip({ template, label }: { template: Template; label?: Pick<Label, "values" | "overrides" | "invert"> }) {
  const sizeId = useEditorView((s) => s.sizeId);
  const setView = useEditorView((s) => s.set);
  const settings = useLabelStore((s) => s.settings);
  const [all, setAll] = useState(false);
  const areaFit = (t: Template, id: string) => {
    const v = makeView(t, id, settings.printer, settings.marginMm);
    return sizeFit(t.design, { w: v.width, h: v.height });
  };
  const ranked = SIZES.map((s) => ({ id: s.id, fit: areaFit(template, s.id) }))
    .map((x) => ({ ...x, fit: Number.isFinite(x.fit) ? x.fit : Infinity }))
    .sort((a, b) => a.fit - b.fit);
  const good = ranked.filter((x) => x.fit < GOOD_FIT || x.id === sizeId);
  const ids = ["design", ...(all ? ranked : good.length ? good : ranked.slice(0, 6)).map((x) => x.id)];
  const fitOf = new Map(ranked.map((x) => [x.id, x.fit]));

  return (
    <div className="border-t bg-card">
      <div className="flex items-center gap-1.5 px-3 pt-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        <IconStack2 className="size-3.5" /> {all ? "All sizes" : "Sizes this design suits"}
        <button className="ml-1 rounded px-1 normal-case tracking-normal text-sky-600 hover:underline dark:text-sky-400" onClick={() => setAll(!all)}>
          {all ? "Only good fits" : `Show all ${SIZES.length}`}
        </button>
      </div>
      <div className="flex items-end gap-3 overflow-x-auto px-3 pt-1 pb-2">
        {ids.map((id) => {
          const view = makeView(template, id, settings.printer, settings.marginMm);
          const variants = (template.variants ?? []).filter((v) => matchesRule(v.when, view.width, view.height));
          const name = id === "design" ? "Design" : `${sizePrinterName(view.size)} ${view.size.name}`;
          const poor = id !== "design" && (fitOf.get(id) ?? 0) >= GOOD_FIT;
          return (
            <button
              key={id}
              className={cn("flex shrink-0 flex-col items-center gap-1 rounded-md p-1 hover:bg-muted", sizeId === id && "bg-sky-500/10 ring-1 ring-sky-500")}
              onClick={() => setView({ sizeId: id })}
              title={poor ? `Edit at ${view.size.name}: a different shape from the design, so it may not reflow well (a variant can fix it)` : `Edit at ${view.size.name}`}
            >
              <TemplateThumb template={template} label={label} sizeId={id} printer={settings.printer} marginMm={settings.marginMm} scale={3.2} />
              <span className={cn("flex items-center gap-1 text-[10px] whitespace-nowrap text-muted-foreground", poor && "opacity-60")}>
                {name}
                {variants.length > 0 && (
                  <Tip tip={`Variant: ${variants.map((v) => v.name).join(", ")}`}>
                    <span className="size-1.5 rounded-full bg-amber-500" />
                  </Tip>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

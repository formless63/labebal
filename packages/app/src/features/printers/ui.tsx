"use client";
import type { ReactNode } from "react";
import { IconInfoCircle } from "@tabler/icons-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";

/** Small (i) with an explanation, for terms that need one. */
export function Hint({ children, label = "What is this?" }: { children: ReactNode; label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex align-middle text-muted-foreground hover:text-foreground" aria-label={label}>
          <IconInfoCircle className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{children}</TooltipContent>
    </Tooltip>
  );
}

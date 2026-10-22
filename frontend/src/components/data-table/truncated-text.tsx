"use client";

import { useEffect, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** The DOM always contains the full string; only visually overflowing text gains a focusable reveal. */
export function TruncatedText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const measure = () => { if (ref.current) setOverflow(ref.current.scrollWidth > ref.current.clientWidth); };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    if (ref.current) observer?.observe(ref.current);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [text, overflow]);
  const content = <span ref={ref} className={cn("block min-w-0 truncate", className)}>{text}</span>;
  if (!overflow) return content;
  return <TooltipProvider><Tooltip><TooltipTrigger render={content} tabIndex={0} /><TooltipContent role="tooltip">{text}</TooltipContent></Tooltip></TooltipProvider>;
}

export function TwoLineCell({ primary, secondary, missing = false }: { primary: string; secondary?: string | null; missing?: boolean }) {
  return <div className="flex min-w-0 flex-col gap-1">
    <TruncatedText text={primary} className={cn("text-sm font-medium text-foreground", missing && "text-muted-foreground")} />
    {secondary && <TruncatedText text={secondary} className="text-[12.5px] text-muted-foreground" />}
  </div>;
}

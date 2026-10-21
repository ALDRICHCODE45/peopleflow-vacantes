"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Keep the full plain-text note available to keyboard and pointer users. */
export function CloseReasonNote({ note }: { note: string | null }) {
  if (!note) return null;
  return <Tooltip><TooltipTrigger render={<span tabIndex={0} className="block max-w-64 truncate text-xs text-muted-foreground" />}>{note}</TooltipTrigger><TooltipContent className="max-w-xs whitespace-pre-wrap break-words">{note}</TooltipContent></Tooltip>;
}

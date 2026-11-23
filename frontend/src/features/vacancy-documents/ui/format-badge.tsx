import type { ReactNode } from "react";
import { cn } from "cn";
import type { DocumentFormat } from "../model";
import { FORMAT_LABEL } from "./format";

/** Artboard 03 `.ft`: PDF in `--status-danger`, Word in `--status-info`, Excel in `--status-success`, JPG/PNG in `--status-review`. */
const TONE: Record<DocumentFormat, string> = {
  pdf: "border-status-danger/25 bg-status-danger/8 text-status-danger",
  docx: "border-status-info/25 bg-status-info/8 text-status-info",
  xlsx: "border-status-success/25 bg-status-success/8 text-status-success",
  jpg: "border-status-review/25 bg-status-review/8 text-status-review",
  png: "border-status-review/25 bg-status-review/8 text-status-review",
};
const BOX = "relative flex shrink-0 rounded-lg border";
const SIZE = { sm: "h-[38px] w-8 text-[9px] leading-3", md: "h-12 w-10 text-[11px] leading-3" } as const;

/** The file-type tile of a row: the format's name on a tinted page, colored by its status token (decorative: the format is also spelled in the meta line). */
export function FormatBadge({ format, size = "sm", children }: { format: DocumentFormat; size?: keyof typeof SIZE; children?: ReactNode }) {
  return <span aria-hidden="true" data-pf-format={format} className={cn(BOX, SIZE[size], "items-end justify-center pb-[5px] font-bold tracking-wide", TONE[format])}>
    {FORMAT_LABEL[format]}{children}
  </span>;
}

/** The same tile for a link that has no file to show («Documento eliminado», «Sin acceso»): a dashed muted page around the glyph. */
export function GhostBadge({ children }: { children: ReactNode }) {
  return <span aria-hidden="true" data-pf-format="none" className={cn(BOX, SIZE.sm, "items-center justify-center border-dashed bg-muted text-muted-foreground [&_svg]:size-4")}>{children}</span>;
}

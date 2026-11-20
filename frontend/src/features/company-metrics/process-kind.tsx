import type { ReactNode } from "react";
import { ReplacementTags } from "@/features/vacancy-lifecycle/ui/replacement-badges";
import { cn } from "@/lib/utils";

/**
 * replacement-processes-v1 «Metrics» (S7): the figures the normative table marks «vacancy level — root only» ignore
 * `process_kind`. While the filter is on, each says so in one short muted line, so a number that did not move is not
 * read as a filtered one. In the default «Todos» view nothing differs and nothing is shown.
 */
export const PROCESS_NOTE = "No cambia con el filtro de proceso";
type Scope = { process_kind?: string };
export const isProcessFiltered = (filters: Scope) => Boolean(filters.process_kind);

/** The caption itself; `children` says it for a group of figures («Vacantes asignadas» y «Conversión» …). */
export function ProcessNote({ filters, className, as: Tag = "p", children = PROCESS_NOTE }: { filters: Scope; className?: string; /** `span` inside a caption that is already a paragraph. */ as?: "p" | "span"; children?: ReactNode }) {
  if (!isProcessFiltered(filters)) return null;
  return <Tag className={cn("text-xs text-muted-foreground", Tag === "span" && "block", className)}>{children}</Tag>;
}

/**
 * A vacancy's title and, only for a replacement, the shared «Reemplazo» badge; an old backend sends no `kind`, so it renders as before.
 * It wraps: in a narrow (stacked) cell the badge drops to its own line instead of covering the text beside it.
 */
export function VacancyWithKind({ kind, className, children }: { kind?: "original" | "replacement"; className?: string; children: ReactNode }) {
  if (kind !== "replacement") return <>{children}</>;
  return <span className={cn("inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1", className)}>{children}<ReplacementTags kind={kind} /></span>;
}

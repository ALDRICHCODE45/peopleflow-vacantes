import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Canonical dashboard page padding.
 *
 * Every dashboard route owns exactly one outer padding owner, and it uses this
 * recipe: 16px on mobile and 24px from `md` up on the vertical axis, with the
 * existing 16px mobile / 24px `lg`+ horizontal inset. Keeping the recipe in one
 * exported constant is what stops the inset from drifting per route and from
 * being fragmented across child sections.
 */
export const DASHBOARD_PAGE_PADDING = "px-4 py-4 md:py-6 lg:px-6"

/**
 * Content measure of a dashboard route.
 *
 * - `full`: the whole canvas, the default for the employer workspaces.
 * - `screen-2xl`: the candidate canonical measure, declared once on the root and
 *   never reintroduced by a narrower inner wrapper.
 * - `7xl`: the enriched employer form canvas that still needs the dossier rail.
 */
export type DashboardPageWidth = "full" | "screen-2xl" | "7xl"

const WIDTH_CLASS: Readonly<Record<Exclude<DashboardPageWidth, "full">, string>> = {
  "screen-2xl": "mx-auto w-full max-w-screen-2xl",
  "7xl": "mx-auto w-full max-w-7xl",
}

export type DashboardPageContentProps = React.ComponentProps<"div"> & {
  /** Content measure; `full` (the default) keeps the whole canvas. */
  width?: DashboardPageWidth
  /** Marks this element as the `@container/main` query root. */
  container?: boolean
}

/**
 * Shared product layout wrapper for dashboard route content.
 *
 * It renders the single padded, full-bleed content column a dashboard route
 * mounts below its header, so routes compose their sections directly instead of
 * threading `px-*`/`py-*` through `SectionCards`, the chart, `ActiveVacancies`
 * and `DataTable`. Callers own their internal layout (stack, grid, gap) through
 * `className`; the wrapper owns the page inset and the optional measure.
 */
export function DashboardPageContent({
  width = "full",
  container = false,
  className,
  ...props
}: DashboardPageContentProps) {
  return (
    <div
      data-pf-page-content=""
      className={cn(
        "flex flex-col",
        DASHBOARD_PAGE_PADDING,
        width !== "full" && WIDTH_CLASS[width],
        container && "@container/main",
        className
      )}
      {...props}
    />
  )
}

import type { ComponentProps } from "react";
import { cn } from "cn";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/**
 * Responsive choice layout for one contract option set: a full-width grid that is
 * one column on phones and splits from `sm`. Choices fill their track
 * (`w-full min-w-0`) and wrap their label (`whitespace-normal h-auto`), so a long
 * option such as "Tiempo completo" stays inside its own control.
 */
export type ChoiceGridColumns = 2 | 3;

const COLUMN_CLASSES: Record<ChoiceGridColumns, string> = {
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
};

export type ChoiceGridProps = ComponentProps<typeof ToggleGroup> & {
  /** Columns from `sm` up; phones always get one choice per row. */
  columns?: ChoiceGridColumns;
};

export function ChoiceGrid({ columns = 2, className, ...props }: ChoiceGridProps) {
  return (
    <ToggleGroup
      data-pf-choice-grid=""
      className={cn(
        "grid w-full items-stretch gap-2",
        COLUMN_CLASSES[columns],
        className,
      )}
      {...props}
    />
  );
}

export type ChoiceGridItemProps = ComponentProps<typeof ToggleGroupItem>;

/** One choice of a {@link ChoiceGrid}; it never overflows its own track. */
export function ChoiceGridItem({ className, ...props }: ChoiceGridItemProps) {
  return (
    <ToggleGroupItem
      className={cn("h-auto w-full min-w-0 whitespace-normal text-center", className)}
      {...props}
    />
  );
}

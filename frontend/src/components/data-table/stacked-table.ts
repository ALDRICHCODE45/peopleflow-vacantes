/**
 * Rule 14 (`design/system.md`, narrow screens): below `md` an overview or detail table becomes list rows, so nothing
 * scrolls sideways and no figure is lost. One markup for every width (no second copy of the links in the DOM): the
 * header row hides, each row stacks, the first cell is the row's title and every other cell names its column through
 * `data-label` (shown before its value).
 */
export const STACKED_TABLE = "max-md:block max-md:[&_tbody]:block max-md:[&_thead]:hidden";
/** Each row as a two-column list item. */
export const STACKED_ROW = "max-md:grid max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-3 max-md:py-4";
/** The row's title (its first cell): full width, wrapping. */
export const STACKED_TITLE = "max-md:col-span-2 max-md:block max-md:h-auto max-md:p-0 max-md:whitespace-normal";
/** A labelled value: its column name (`data-label`) above it, left-aligned. */
export const STACKED_CELL = "max-md:block max-md:h-auto max-md:p-0 max-md:text-left max-md:whitespace-normal max-md:before:mb-1 max-md:before:block max-md:before:text-xs max-md:before:font-normal max-md:before:text-muted-foreground max-md:before:content-[attr(data-label)]";

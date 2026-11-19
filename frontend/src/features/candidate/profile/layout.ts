/**
 * Page grid of `/candidato/perfil` (artboard 01): the identity card in a sticky left column (300 px from `lg`, 320 px
 * from `xl`) and the tabbed card on the right. Below `lg` the identity card stacks on top.
 */
export const LAYOUT = "grid min-w-0 grid-cols-1 items-start gap-4 sm:gap-6 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)]";
export const ASIDE = "min-w-0 lg:sticky lg:top-6";
export const TAB_CARD = "flex min-w-0 flex-col rounded-[min(var(--radius-4xl),24px)] bg-card text-sm text-card-foreground shadow-sm ring-1 ring-foreground/5 dark:ring-foreground/10";

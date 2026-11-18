/**
 * Page grid of `/candidato/perfil`: the ficha and the sections on the left, a 320 px rail from `lg`. Between `sm` and
 * `lg` the rail sits below in two columns. Below `sm` the rail dissolves into the page grid (`contents`), so an
 * incomplete profile can lift only its progress card above the ficha (`RAIL_FIRST`).
 */
export const LAYOUT = "grid min-w-0 grid-cols-1 items-start gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_320px]";
export const MAIN = "flex min-w-0 flex-col gap-4";
export const RAIL = "grid min-w-0 grid-cols-1 items-start gap-4 max-sm:contents sm:grid-cols-2 lg:sticky lg:top-6 lg:grid-cols-1";
export const RAIL_FIRST = "max-sm:order-first";

/** Keep desktop gutters inside the viewport-sized provider; the inset variant keeps the
 * primitive's sidebar-coloured backdrop so the rail blends in. Peer-qualified
 * overrides replace the inset primitive's margins, radius and shadow. */
export const dashboardProviderClassName = "bg-primary/5 md:py-3";

export const dashboardInsetClassName = "md:peer-data-[variant=inset]:my-0 md:peer-data-[variant=inset]:mr-3 md:peer-data-[variant=inset]:rounded-3xl md:ring-1 md:ring-primary/15 md:peer-data-[variant=inset]:shadow-md";

/** Where an organic application started; self-reported analytics for the apply body. */
export type ApplicationChannel = "portal" | "careers_site";

/** Query value a company careers site adds to its vacancy links; only this exact value marks that origin. */
const CAREERS_SITE_ORIGIN = "sitio";

/** Canonical `/vacantes/<jobId>/postular` route for one known vacancy id, keeping a careers site origin. */
export function vacancyApplicationHref(jobId: string, channel: ApplicationChannel = "portal"): string {
  return channel === "careers_site" ? `/vacantes/${jobId}/postular?origen=${CAREERS_SITE_ORIGIN}` : `/vacantes/${jobId}/postular`;
}

/** Vacancy detail link from a company careers site. */
export function careersSiteVacancyHref(jobId: string): string {
  return `/vacantes/${jobId}?origen=${CAREERS_SITE_ORIGIN}`;
}

/** Any other or missing `origen` value is the public portal. */
export function applicationChannel(origin: unknown): ApplicationChannel {
  return origin === CAREERS_SITE_ORIGIN ? "careers_site" : "portal";
}

/** Canonical `/vacantes/<jobId>/postular` route for one known vacancy id. */
export function vacancyApplicationHref(jobId: string): string {
  return `/vacantes/${jobId}/postular`;
}

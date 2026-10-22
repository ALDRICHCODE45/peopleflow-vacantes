/** Same-origin downloads; the route keeps authentication and upstream storage details server-side. */
export function participationCvHref(vacancyId: string, participationId: string, version: "current" | "original" = "current") {
  return `/api/company/vacancies/${encodeURIComponent(vacancyId)}/participations/${encodeURIComponent(participationId)}/cv${version === "original" ? "/original" : ""}`;
}

/**
 * «Tu empresa» (A4.5, step 3 of the company sign-up): where a signed-in
 * employer without a users row, or a recruiter without a company opening the
 * employer landing, is sent to create the employer account and the company.
 */
export const EMPLOYER_COMPANY_STEP = "/empresa/registro/empresa";

/** The employer landings the post-sign-in callback and the sidebar «Inicio» open. */
const EMPLOYER_LANDINGS: ReadonlySet<string> = new Set(["/empresa", "/empresa/dashboard"]);

export function isEmployerLanding(pathname: string | null | undefined): boolean {
  return !!pathname && EMPLOYER_LANDINGS.has(pathname);
}

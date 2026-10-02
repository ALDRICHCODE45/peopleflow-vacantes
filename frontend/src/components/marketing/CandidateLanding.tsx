import { EmployerFooter, EmployerLanding } from "./EmployerLanding";

/** Same marketing composition; only copy, illustrations and hero accents differ. */
export function CandidateLanding() {
  return <EmployerLanding candidate />;
}

export function CandidateFooter() {
  return <EmployerFooter candidate />;
}

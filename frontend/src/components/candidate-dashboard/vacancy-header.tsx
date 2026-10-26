"use client";

import { usePathname } from "next/navigation";
import { CandidateHeader } from "./candidate-header";

/** Public navigation is pathname-only: no identity or extra vacancy data read. */
export function VacancyHeader() {
  const pathname = usePathname();
  const segments = pathname?.split("/").filter(Boolean) ?? [];
  const jobId = segments[1];
  if (!jobId) return <CandidateHeader title="Vacantes" heading={false} />;
  if (segments[2] === "postular") return <CandidateHeader title="Postulación" parent={{ label: "Detalle de la vacante", href: `/vacantes/${jobId}` }} heading={false} />;
  return <CandidateHeader title="Detalle de la vacante" parent={{ label: "Vacantes", href: "/vacantes" }} heading={false} />;
}

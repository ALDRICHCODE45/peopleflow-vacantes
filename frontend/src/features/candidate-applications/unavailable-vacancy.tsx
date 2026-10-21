import { Briefcase } from "lucide-react";
import { StateCard } from "@/components/feedback/state-card";
import type { UnavailableVacancy } from "@/features/jobs/api/vacancy-availability";

export function UnavailableVacancyCard({ vacancy, headingLevel = 2 }: { vacancy: UnavailableVacancy; headingLevel?: 1 | 2 }) {
  const paused = vacancy.availability === "paused";
  return <StateCard icon={Briefcase} tone="info" headingLevel={headingLevel}
    title={paused ? "Vacante pausada" : "Vacante cerrada"}
    description={<>{vacancy.title} · {vacancy.company.name}<br />{paused ? "Esta vacante no está recibiendo postulaciones por ahora." : "Esta vacante ya no recibe postulaciones."}</>}
    primaryAction={{ label: "Ver otras vacantes", href: "/vacantes" }} />;
}

import { Clock3, Gift, GraduationCap, Heart, House, Laptop, ShieldPlus, Sun, type LucideIcon } from "lucide-react";
import type { PublicDetailPresentation } from "./public-detail-presentation";
import { benefitLabel } from "../drafts/ui/draft-labels";

type BenefitCode = PublicDetailPresentation["benefits"]["predefined"][number];
const BENEFIT_ICONS = {
  health_insurance: ShieldPlus,
  computer_equipment: Laptop,
  flexible_schedule: Clock3,
  remote_stipend: House,
  training_budget: GraduationCap,
  extra_time_off: Sun,
  wellness: Heart,
  annual_bonus: Gift,
} satisfies Record<BenefitCode, LucideIcon>;

export function publicDetailBenefits(job: PublicDetailPresentation) {
  return [
    ...job.benefits.predefined.map(code => ({ label: benefitLabel(code), Icon: BENEFIT_ICONS[code] })),
    ...job.benefits.custom.map(label => ({ label, Icon: Gift })),
  ];
}

/** Navigation and loading share exactly the same data-presence decisions. */
export function publicDetailSections(job?: PublicDetailPresentation) {
  return [
    { id: "descripcion", label: "Descripción", present: job === undefined || job.description_plain.trim() !== "" },
    { id: "requisitos", label: "Requisitos", present: job === undefined || Boolean(job.requirements.required?.trim() || job.requirements.preferred?.trim() || job.requirements_profile.languages.length || job.requirements_profile.min_years_of_experience !== null || job.requirements_profile.min_education_level !== null) },
    { id: "habilidades", label: "Habilidades", present: job === undefined || job.skills.length > 0 },
    { id: "beneficios", label: "Beneficios", present: job === undefined || publicDetailBenefits(job).length > 0 },
  ].filter(section => section.present);
}

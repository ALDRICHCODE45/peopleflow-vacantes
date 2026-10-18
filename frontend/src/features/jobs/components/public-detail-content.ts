import { Clock3, Gift, GraduationCap, Heart, House, Laptop, ShieldPlus, Sun, type LucideIcon } from "lucide-react";
import type { PublicJobDetail } from "../types";
import { benefitLabel } from "../drafts/ui/draft-labels";

type BenefitCode = PublicJobDetail["benefits"]["predefined"][number];
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

export function publicDetailBenefits(job: PublicJobDetail) {
  return [
    ...job.benefits.predefined.map(code => ({ label: benefitLabel(code), Icon: BENEFIT_ICONS[code] })),
    ...job.benefits.custom.map(label => ({ label, Icon: Gift })),
  ];
}

/** Navigation and loading share exactly the same data-presence decisions. */
export function publicDetailSections(job?: PublicJobDetail) {
  return [
    { id: "descripcion", label: "Descripción", present: job === undefined || job.description_plain.trim() !== "" },
    { id: "requisitos", label: "Requisitos", present: job === undefined || Boolean(job.requirements.required?.trim() || job.requirements.preferred?.trim()) },
    { id: "habilidades", label: "Habilidades", present: job === undefined || job.skills.length > 0 },
    { id: "beneficios", label: "Beneficios", present: job === undefined || publicDetailBenefits(job).length > 0 },
  ].filter(section => section.present);
}

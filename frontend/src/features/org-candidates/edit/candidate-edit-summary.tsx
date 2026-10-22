import { BriefcaseBusiness, ContactRound, GraduationCap, Languages, Link, Mail, MapPin, Phone, Sparkles, TrendingUp, type LucideIcon } from "lucide-react";
import { editValueLabel } from "./edit-draft";
import { CANDIDATE_EDIT_FIELDS, type CandidateEditBody, type CandidateEditField, type CandidateEditValues } from "./edit-model";

const fields: Record<CandidateEditField, { label: string; icon: LucideIcon }> = {
 full_name: { label: "Nombre completo", icon: ContactRound },
 email: { label: "Correo", icon: Mail },
 phone: { label: "Teléfono", icon: Phone },
 location: { label: "Ubicación", icon: MapPin },
 professional_title: { label: "Título profesional", icon: BriefcaseBusiness },
 current_company: { label: "Empresa actual", icon: BriefcaseBusiness },
 seniority: { label: "Seniority", icon: TrendingUp },
 years_of_experience: { label: "Años de experiencia", icon: BriefcaseBusiness },
 education: { label: "Estudios", icon: GraduationCap },
 languages: { label: "Idiomas", icon: Languages },
 skills: { label: "Habilidades", icon: Sparkles },
 linkedin_url: { label: "LinkedIn", icon: Link },
 portfolio_url: { label: "Portafolio", icon: Link },
};
function summaryValue(field: CandidateEditField, value: CandidateEditValues[CandidateEditField]): string {
 if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) return "Sin dato";
 if (field === "years_of_experience") return `${value} ${Number(value) === 1 ? "año" : "años"}`;
 return editValueLabel(field, value);
}

/** Reads the validated payload itself, including normalized contact values and resets. */
export function CandidateEditSummary({ body }: { body: CandidateEditBody }) {
 return <dl className="flex shrink-0 flex-col gap-3 text-sm">
  {CANDIDATE_EDIT_FIELDS.map(field => {
   const reset = body.reset?.includes(field);
   const value = body.set[field];
   if (!reset && value === undefined) return null;
   const { label, icon: Icon } = fields[field];
   return <div key={field} className="flex min-w-0 flex-col gap-1">
    <dt className="flex items-center gap-2 text-xs text-muted-foreground"><Icon aria-hidden="true" className="size-3.5 shrink-0" />{label}</dt>
    <dd className="line-clamp-2 break-words">{reset ? "Se restaurará el original" : summaryValue(field, value!)}</dd>
   </div>;
  })}
 </dl>;
}

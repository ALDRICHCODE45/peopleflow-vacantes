import { ListChecksIcon, UsersIcon, ZapIcon } from "lucide-react";
import type { PublicJobItem } from "../types";

const APPLICANT_LABELS = {
  under_10: "Menos de 10 postulantes",
  "10_plus": "Más de 10 postulantes",
  "25_plus": "Más de 25 postulantes",
  "50_plus": "Más de 50 postulantes",
} as const satisfies Record<NonNullable<PublicJobItem["applicants"]>, string>;

export function PublicApplicants({ applicants }: Pick<PublicJobItem, "applicants">) {
  if (applicants === null) return null;
  return <span className="inline-flex min-w-0 items-center gap-1.5"><UsersIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />{APPLICANT_LABELS[applicants]}</span>;
}

export function PublicScreeningInfo({ count }: { count: PublicJobItem["screening_questions"] }) {
  if (count === null) return null;
  const Icon = count === 0 ? ZapIcon : ListChecksIcon;
  const label = count === 0 ? "Postulación rápida" : count === 1 ? "1 pregunta de filtro" : `${count} preguntas de filtro`;
  return <p className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground"><Icon aria-hidden="true" className="size-4 shrink-0" />{label}</p>;
}

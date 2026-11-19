"use client";

import type { ReactNode } from "react";
import { GraduationCap, Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGeoCatalog } from "@/features/geo/use-geo-catalog";
import { locationReadToValue, type LocationValue } from "@/features/geo/model";
import { useLanguageCatalog } from "@/features/languages/use-language-catalog";
import { cn } from "@/lib/utils";
import { CEFR_LEVEL_LABELS, SALARY_PERIOD_LABELS, SENIORITY_LABELS } from "../model";
import type { CandidateProfileDraft, ProfileBaseline } from "../profile-draft";
import type { ProfileCategory } from "../profile-form-fields";
import { dateText, levelText, moneyText, phoneText, skillList, studyDetails, urlText, yearsText } from "./format";
import { sectionVisibility, visibleToCompany, type VisibilityField } from "./visibility";

/**
 * Read views of the five tabs (artboard 01): the same grid as the form, label over value. A lock sits only on the
 * label of a private fact inside a mixed tab; an all-private tab says it once on its tab and its panel line.
 */
const GRID = "grid grid-cols-1 gap-x-6 gap-y-5 min-[480px]:grid-cols-2";
const GRID6 = "grid grid-cols-1 gap-x-6 gap-y-5 min-[480px]:grid-cols-6";
const GRID3 = "grid grid-cols-1 gap-x-6 gap-y-5 min-[480px]:grid-cols-2 md:grid-cols-3";
const SUB = "text-[13px] leading-[18px] font-semibold text-muted-foreground";
const CHIP = "inline-flex min-h-7 items-center rounded-full bg-card px-3 py-1 text-[13px] font-medium text-foreground ring-1 ring-border ring-inset";

/** Whether `field` carries a lock in `tab`: private, inside a tab that also holds company-visible facts. */
export const lockedIn = (tab: ProfileCategory, field: VisibilityField) => sectionVisibility(tab) === "mixed" && !visibleToCompany(field);
/** The lock beside a private label; its words reach screen readers as part of the label. */
export function PrivateMark({ field }: { field: VisibilityField }) {
  return <span data-pf-profile-lock={field} title="Solo tú" className="inline-flex shrink-0 text-muted-foreground"><Lock aria-hidden="true" className="size-3" strokeWidth={2.25} /><span className="sr-only"> (solo tú)</span></span>;
}
function Fact({ tab, field, label, value, className, paragraph }: { tab: ProfileCategory; field?: VisibilityField; label: string; value: ReactNode; className?: string; paragraph?: boolean }) {
  return <div className={cn("min-w-0", className)}>
    <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">{label}{field && lockedIn(tab, field) && <PrivateMark field={field} />}</dt>
    {value
      ? <dd className={cn("mt-1 [overflow-wrap:anywhere]", paragraph ? "max-w-[68ch] text-sm leading-[22px] whitespace-pre-line sm:text-[15px] sm:leading-6" : "font-medium tabular-nums")}>{value}</dd>
      : <dd className="mt-1 text-muted-foreground">Sin dato</dd>}
  </div>;
}
function Placeholder({ text, action, onAdd }: { text: string; action: string; onAdd: () => void }) {
  return <div data-pf-profile-placeholder="" className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-dashed border-border p-4 text-muted-foreground">
    <p className="min-w-44 flex-1">{text}</p>
    <Button type="button" variant="outline" className="min-h-10 max-sm:min-h-11 max-sm:w-full" onClick={onAdd}><Plus data-icon="inline-start" aria-hidden="true" />{action}</Button>
  </div>;
}

const sameLocation = (a: LocationValue, b: LocationValue) => a.country === b.country && a.state === b.state && a.municipality === b.municipality;
/** An edited, unsaved location named from the geo catalog (the saved one carries its server label). */
function DraftLocation({ value }: { value: LocationValue }) {
  const { countries, states, municipalities } = useGeoCatalog(value.state, value.country === "MX");
  const name = (resource: { status: string; data?: { items: { id: string; name: string }[] } }, id: string | null) => id && resource.status === "success" ? resource.data?.items.find(item => item.id === id)?.name : undefined;
  const parts = [name(municipalities, value.municipality), name(states, value.state), value.state ? undefined : name(countries, value.country)].filter(Boolean);
  return <>{parts.length ? parts.join(", ") : "Ubicación sin guardar"}</>;
}
export function LocationText({ draft, baseline }: { draft: CandidateProfileDraft; baseline: ProfileBaseline }) {
  if (draft.location.country === null) return null;
  if (baseline.location && sameLocation(draft.location, locationReadToValue(baseline.location))) return <>{baseline.location.label}</>;
  return <DraftLocation value={draft.location} />;
}

function Languages({ draft, onAdd }: { draft: CandidateProfileDraft; onAdd: () => void }) {
  const catalog = useLanguageCatalog();
  const name = (code: string) => catalog.data?.items.find(item => item.code === code)?.name ?? (code ? code.toUpperCase() : "Idioma sin elegir");
  if (!draft.languages.length) return <Placeholder text="¿Qué idiomas hablas? Indica tu nivel de cada uno." action="Agregar idioma" onAdd={onAdd} />;
  return <ul aria-label="Tus idiomas" className="flex flex-col divide-y divide-border">{draft.languages.map((row, index) => (
    <li key={`${row.code}-${index}`} className="flex min-h-11 min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
      <b className="min-w-0 font-medium break-words">{name(row.code)}</b>
      <span className="text-muted-foreground tabular-nums">{row.level ? CEFR_LEVEL_LABELS[row.level] : "Sin nivel"}</span>
    </li>
  ))}</ul>;
}

export function TabRead({ tab, draft, baseline, email, onAdd }: { tab: ProfileCategory; draft: CandidateProfileDraft; baseline: ProfileBaseline; email: string; onAdd: () => void }) {
  if (tab === "personal") return <dl className={GRID}>
    <Fact tab={tab} field="phone" label="Teléfono" value={phoneText(draft)} />
    <Fact tab={tab} field="birthDate" label="Fecha de nacimiento" value={dateText(draft.birthDate)} />
    <Fact tab={tab} field="location" label="Ubicación" value={draft.location.country === null ? "" : <LocationText draft={draft} baseline={baseline} />} />
    <Fact tab={tab} field="email" label="Correo de tu cuenta" value={email} />
    <Fact tab={tab} field="linkedinUrl" label="Perfil de LinkedIn" value={urlText(draft.linkedinUrl)} />
    <Fact tab={tab} field="portfolioUrl" label="Portafolio o sitio web" value={urlText(draft.portfolioUrl)} />
  </dl>;
  if (tab === "experience") {
    if (![draft.professionalTitle, draft.currentCompany, draft.yearsOfExperience, draft.seniority, draft.summary].some(value => value.trim())) return <Placeholder text="Cuenta en qué trabajas: título, empresa, años y nivel." action="Agregar experiencia" onAdd={onAdd} />;
    return <dl className={GRID6}>
      <Fact tab={tab} field="professionalTitle" label="Título profesional" value={draft.professionalTitle.trim()} className="min-[480px]:col-span-4" />
      <Fact tab={tab} field="seniority" label="Seniority" value={draft.seniority ? SENIORITY_LABELS[draft.seniority] : ""} className="min-[480px]:col-span-2" />
      <Fact tab={tab} field="currentCompany" label="Empresa actual o última" value={draft.currentCompany.trim()} className="min-[480px]:col-span-4" />
      <Fact tab={tab} field="yearsOfExperience" label="Años de experiencia" value={yearsText(draft.yearsOfExperience)} className="min-[480px]:col-span-2" />
      <Fact tab={tab} field="summary" label="Resumen profesional" value={draft.summary.trim()} className="min-[480px]:col-span-6" paragraph />
    </dl>;
  }
  if (tab === "education") {
    const skills = skillList(draft.skills);
    return <>
      <div className="flex min-w-0 flex-col gap-3">
        <p className={SUB}>Estudios</p>
        {draft.education.length ? <ul aria-label="Tus estudios" className="flex flex-col gap-3.5">{draft.education.map((study, index) => (
          <li key={index} className="grid grid-cols-[36px_minmax(0,1fr)] items-start gap-3">
            <span aria-hidden="true" className="grid size-9 place-items-center rounded-xl bg-muted text-foreground"><GraduationCap className="size-4" /></span>
            <div className="min-w-0">
              <b className="block font-semibold break-words">{levelText(study.level) || "Nivel sin elegir"}</b>
              <span className="flex flex-wrap items-center gap-x-1.5 text-[13px] leading-[18px] text-muted-foreground"><span className="min-w-0 break-words">{studyDetails(study) || "Sin institución ni carrera"}</span>{lockedIn(tab, "educationDetails") && <PrivateMark field="educationDetails" />}</span>
            </div>
          </li>
        ))}</ul> : <Placeholder text="Agrega tus estudios, terminados o en curso." action="Agregar estudio" onAdd={onAdd} />}
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <p className={SUB}>Habilidades{skills.length ? ` · ${skills.length}` : ""}</p>
        {skills.length ? <ul aria-label="Tus habilidades" className="flex flex-wrap gap-1.5">{skills.map((skill, index) => <li key={`${skill}-${index}`} className={CHIP}>{skill}</li>)}</ul> : <p className="text-muted-foreground">Sin habilidades todavía.</p>}
      </div>
    </>;
  }
  if (tab === "languages") return <Languages draft={draft} onAdd={onAdd} />;
  if (![draft.currentSalaryGross, draft.currentSalaryNet, draft.expectedSalary].some(value => value.trim())) return <Placeholder text="Tu salario actual y lo que esperas ganar." action="Agregar compensación" onAdd={onAdd} />;
  return <dl className={GRID3}>
    <Fact tab={tab} field="currentSalaryGross" label="Salario bruto actual" value={moneyText(draft.currentSalaryGross, draft.salaryCurrency)} />
    <Fact tab={tab} field="currentSalaryNet" label="Salario neto actual" value={moneyText(draft.currentSalaryNet, draft.salaryCurrency)} />
    <Fact tab={tab} field="salaryCurrency" label="Moneda" value={draft.salaryCurrency.trim().toUpperCase()} />
    <Fact tab={tab} field="expectedSalary" label="Salario esperado" value={moneyText(draft.expectedSalary, draft.salaryCurrency)} />
    <Fact tab={tab} field="expectedSalaryPeriod" label="Periodo del salario esperado" value={draft.expectedSalaryPeriod ? SALARY_PERIOD_LABELS[draft.expectedSalaryPeriod] : ""} className="min-[480px]:col-span-2" />
  </dl>;
}

"use client";

import type { ReactNode } from "react";
import { Eye, GraduationCap, Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGeoCatalog } from "@/features/geo/use-geo-catalog";
import { locationReadToValue, type LocationValue } from "@/features/geo/model";
import { useLanguageCatalog } from "@/features/languages/use-language-catalog";
import { cn } from "@/lib/utils";
import { CEFR_LEVEL_LABELS, SALARY_PERIOD_LABELS, SENIORITY_LABELS, type CefrLevel } from "../model";
import type { CandidateProfileDraft, ProfileBaseline } from "../profile-draft";
import type { ProfileCategory } from "../profile-form-fields";
import { dateText, highestLevel, levelText, moneyText, phoneText, skillList, studyDetails, urlText, yearsText } from "./format";
import { sectionVisibility, visibleToCompany, type VisibilityField } from "./visibility";

/** Read views of the five sections: every fact a company does not receive carries «Solo tú» (from the map). */
const DL = "grid grid-cols-1 gap-x-6 gap-y-3.5 min-[400px]:grid-cols-2 xl:grid-cols-4";
const WIDE = "min-[400px]:col-span-2";
const DT = "flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground";
const DD = "mt-0.5 font-medium tabular-nums [overflow-wrap:anywhere]";
const NONE = "mt-0.5 text-muted-foreground";
const SUB = "flex items-center gap-1.5 text-[13px] leading-[18px] font-semibold tracking-[0.02em] text-muted-foreground";
const CHIP = "inline-flex min-h-7 items-center rounded-full bg-background px-3 py-1 text-[13px] font-medium text-foreground ring-1 ring-border ring-inset";

/** «Solo tú» beside a fact the company does not receive; nothing for a company-visible fact. */
export function PrivateTag({ field }: { field: VisibilityField }) {
  if (visibleToCompany(field)) return null;
  return <span data-pf-profile-private={field} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground"><Lock aria-hidden="true" className="size-3" />Solo tú</span>;
}
/** In an all-private section the section tag says it once; per-fact tags only mark the exceptions of a mixed one. */
function Tag({ section, field }: { section: ProfileCategory; field: VisibilityField }) {
  return sectionVisibility(section) === "mixed" ? <PrivateTag field={field} /> : null;
}
export function VisibilityTag({ section }: { section: ProfileCategory }) {
  const audience = sectionVisibility(section);
  if (audience === "company") return <span data-pf-profile-visibility="company" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-text"><Eye aria-hidden="true" className="size-3.5" />Lo ven las empresas</span>;
  if (audience === "private") return <span data-pf-profile-visibility="private" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Lock aria-hidden="true" className="size-3.5" />Solo tú · no aparece en tu ficha</span>;
  return <span data-pf-profile-visibility="mixed" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Eye aria-hidden="true" className="size-3.5" />Las empresas lo ven, salvo lo marcado «Solo tú»</span>;
}

function Fact({ label, value, wide, tag }: { label: string; value: ReactNode; wide?: boolean; tag?: ReactNode }) {
  return <div className={cn("min-w-0", wide && WIDE)}>
    <dt className={DT}>{label}{tag}</dt>
    {value ? <dd className={DD}>{value}</dd> : <dd className={NONE}>Sin dato</dd>}
  </div>;
}
function Placeholder({ text, action, onAdd }: { text: string; action: string; onAdd: () => void }) {
  return <div data-pf-profile-placeholder="" className="flex flex-wrap items-center gap-3.5 rounded-xl border border-dashed border-border p-4 text-muted-foreground">
    <Plus aria-hidden="true" className="size-4 shrink-0" />
    <p className="min-w-40 flex-1">{text}</p>
    <Button type="button" variant="outline" className="min-h-10 max-sm:w-full" onClick={onAdd}>{action}</Button>
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

const DOTS: Readonly<Record<CefrLevel, number>> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6, native: 6 };
function Languages({ draft, onAdd }: { draft: CandidateProfileDraft; onAdd: () => void }) {
  const catalog = useLanguageCatalog();
  const name = (code: string) => catalog.data?.items.find(item => item.code === code)?.name ?? (code ? code.toUpperCase() : "Idioma sin elegir");
  if (!draft.languages.length) return <Placeholder text="¿Qué idiomas hablas? Indica tu nivel de cada uno." action="Agregar idioma" onAdd={onAdd} />;
  return <ul aria-label="Tus idiomas" className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">{draft.languages.map((row, index) => (
    <li key={`${row.code}-${index}`} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl bg-background px-3.5 py-3 dark:bg-muted/40">
      <b className="min-w-0 font-semibold break-words">{name(row.code)}</b>
      <span className="flex items-center gap-2.5 text-[13px] whitespace-nowrap text-muted-foreground">
        {row.level ? CEFR_LEVEL_LABELS[row.level] : "Sin nivel"}
        <span aria-hidden="true" data-pf-profile-level-dots={row.level ? DOTS[row.level] : 0} className="inline-flex gap-[3px]">{[1, 2, 3, 4, 5, 6].map(dot => <i key={dot} className={cn("size-2 rounded-full", row.level && dot <= DOTS[row.level] ? "bg-primary-text" : "bg-border")} />)}</span>
      </span>
    </li>
  ))}</ul>;
}

export function SectionRead({ section, draft, baseline, email, onAdd }: { section: ProfileCategory; draft: CandidateProfileDraft; baseline: ProfileBaseline; email: string; onAdd: () => void }) {
  if (section === "experience") {
    if (![draft.professionalTitle, draft.currentCompany, draft.yearsOfExperience, draft.seniority, draft.summary].some(value => value.trim())) return <Placeholder text="Cuenta en qué trabajas: título, empresa, años y nivel." action="Agregar experiencia" onAdd={onAdd} />;
    return <>
      <dl className={DL}>
        <Fact wide label="Título profesional" tag={<Tag section={section} field="professionalTitle" />} value={draft.professionalTitle.trim()} />
        <Fact wide label="Empresa actual o última" tag={<Tag section={section} field="currentCompany" />} value={draft.currentCompany.trim()} />
        <Fact label="Años de experiencia" tag={<Tag section={section} field="yearsOfExperience" />} value={yearsText(draft.yearsOfExperience)} />
        <Fact label="Seniority" tag={<Tag section={section} field="seniority" />} value={draft.seniority ? SENIORITY_LABELS[draft.seniority] : ""} />
      </dl>
      <div>
        <p className={cn(SUB, "mb-1.5")}>Resumen profesional <Tag section={section} field="summary" /></p>
        {draft.summary.trim() ? <p className="max-w-[72ch] text-[15px] leading-6 whitespace-pre-line [overflow-wrap:anywhere]">{draft.summary.trim()}</p> : <p className="text-muted-foreground">Sin resumen todavía.</p>}
      </div>
    </>;
  }
  if (section === "education") {
    const skills = skillList(draft.skills);
    const highest = highestLevel(draft.education);
    return <>
      {draft.education.length ? <div className="flex flex-col gap-3">
        {highest && visibleToCompany("educationLevel") && <p data-pf-profile-highest="" className="flex items-start gap-1.5 text-[13px] leading-[18px] text-muted-foreground"><Eye aria-hidden="true" className="mt-px size-3.5 shrink-0 text-primary-text" /><span>Las empresas ven tu nivel más alto: <b className="font-semibold text-foreground">{levelText(highest)}</b>.</span></p>}
        <ul aria-label="Tus estudios" className="flex flex-col gap-3.5">{draft.education.map((study, index) => {
          const details = studyDetails(study);
          return <li key={index} className="grid grid-cols-[40px_minmax(0,1fr)] items-start gap-3.5">
            <span aria-hidden="true" className="grid size-10 place-items-center rounded-xl bg-muted text-foreground"><GraduationCap className="size-4" /></span>
            <div className="min-w-0">
              <b className="block font-semibold break-words">{levelText(study.level) || "Nivel sin elegir"}</b>
              <span className="flex flex-wrap items-center gap-x-2 text-[13px] leading-[18px] text-muted-foreground"><span className="min-w-0 break-words">{details || "Sin institución ni carrera"}</span><Tag section={section} field="educationDetails" /></span>
            </div>
          </li>;
        })}</ul>
      </div> : <Placeholder text="Agrega tus estudios, terminados o en curso." action="Agregar estudio" onAdd={onAdd} />}
      <div>
        <p className={cn(SUB, "mb-2")}>Habilidades{skills.length ? ` · ${skills.length}` : ""} <Tag section={section} field="skills" /></p>
        {skills.length ? <ul aria-label="Tus habilidades" className="flex flex-wrap gap-1.5">{skills.map((skill, index) => <li key={`${skill}-${index}`} className={CHIP}>{skill}</li>)}</ul> : <p className="text-muted-foreground">Sin habilidades todavía.</p>}
      </div>
    </>;
  }
  if (section === "languages") return <Languages draft={draft} onAdd={onAdd} />;
  if (section === "personal") return <dl className={DL}>
    <Fact label="Teléfono" tag={<Tag section={section} field="phone" />} value={phoneText(draft)} />
    <Fact label="Fecha de nacimiento" tag={<Tag section={section} field="birthDate" />} value={dateText(draft.birthDate)} />
    <Fact wide label="Ubicación" tag={<Tag section={section} field="location" />} value={draft.location.country === null ? "" : <LocationText draft={draft} baseline={baseline} />} />
    <Fact wide label="Correo de tu cuenta" tag={<Tag section={section} field="email" />} value={email} />
    <Fact wide label="Perfil de LinkedIn" tag={<Tag section={section} field="linkedinUrl" />} value={urlText(draft.linkedinUrl)} />
    <Fact wide label="Portafolio o sitio web" tag={<Tag section={section} field="portfolioUrl" />} value={urlText(draft.portfolioUrl)} />
  </dl>;
  if (![draft.currentSalaryGross, draft.currentSalaryNet, draft.expectedSalary].some(value => value.trim())) {
    return <Placeholder text={`Tu salario actual y lo que esperas ganar.${sectionVisibility(section) === "private" ? " Solo tú lo ves." : ""}`} action="Agregar compensación" onAdd={onAdd} />;
  }
  const expected = moneyText(draft.expectedSalary, draft.salaryCurrency);
  return <dl className={DL}>
    <Fact label="Salario bruto actual" tag={<Tag section={section} field="currentSalaryGross" />} value={moneyText(draft.currentSalaryGross, draft.salaryCurrency)} />
    <Fact label="Salario neto actual" tag={<Tag section={section} field="currentSalaryNet" />} value={moneyText(draft.currentSalaryNet, draft.salaryCurrency)} />
    <Fact label="Salario esperado" tag={<Tag section={section} field="expectedSalary" />} value={expected && `${expected}${draft.expectedSalaryPeriod ? ` · ${SALARY_PERIOD_LABELS[draft.expectedSalaryPeriod].toLowerCase()}` : ""}`} />
    <Fact label="Moneda" tag={<Tag section={section} field="salaryCurrency" />} value={draft.salaryCurrency.trim().toUpperCase()} />
  </dl>;
}

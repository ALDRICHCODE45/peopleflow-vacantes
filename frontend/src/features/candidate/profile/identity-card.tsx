"use client";

import { useId, useRef, useState, type CSSProperties } from "react";
import { BriefcaseBusiness, Check, Eye, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Ring } from "@/features/candidate/dashboard/charts";
import { cn } from "@/lib/utils";
import { SENIORITY_LABELS } from "../model";
import type { CandidateProfileDraft, ProfileBaseline } from "../profile-draft";
import type { Completeness, KeyDataKey } from "../profile-completeness";
import { skillList, yearsText } from "./format";
import { LocationText } from "./section-read";
import { companyReceives } from "./visibility";
import styles from "./profile.module.css";

export const WHO_TITLE = "¿Qué ve una empresa?";
export const CV_NOTE = "Y el CV que elijas al postularte.";
export const COPY_NOTE = "Recibe una copia de estos datos al momento de postularte; si después editas tu perfil, esa copia no cambia (salvo tu teléfono).";
const SKILLS_SHOWN = 6;
/** The one action the meter offers for the next missing key data point. */
const NEXT_STEP: Readonly<Record<KeyDataKey, string>> = {
  professionalTitle: "Agrega tu título profesional",
  currentCompany: "Agrega tu empresa actual",
  yearsOfExperience: "Agrega tus años de experiencia",
  summary: "Agrega tu resumen profesional",
  phone: "Agrega tu teléfono",
  location: "Agrega tu ubicación",
  education: "Agrega tus estudios",
  skills: "Agrega tus habilidades",
  expectedSalary: "Agrega tu salario esperado",
  languages: "Agrega tus idiomas",
};
const TILE = "min-w-0 rounded-xl bg-background px-3 py-2.5";
const TILE_LABEL = "flex items-center gap-1.5 text-xs text-muted-foreground";

/** «¿Qué ve una empresa?»: a small popover written from the visibility map, with the copy-at-application line. */
function CompanyView() {
  const copy = companyReceives();
  return <Popover>
    <PopoverTrigger render={<Button type="button" variant="ghost" className="-mx-2.5 min-h-10 self-start px-2.5 text-[13px] text-muted-foreground aria-expanded:bg-muted aria-expanded:text-foreground" />}>
      <Eye data-icon="inline-start" aria-hidden="true" />{WHO_TITLE}
    </PopoverTrigger>
    <PopoverContent align="start" sideOffset={6} className="w-[340px] max-w-[calc(100vw-1.5rem)] gap-1.5 rounded-xl">
      <PopoverTitle className="text-sm font-semibold">{WHO_TITLE}</PopoverTitle>
      <PopoverDescription render={<div />} className="flex flex-col gap-1 text-popover-foreground">
        <p>{copy.company}</p>
        <p>{CV_NOTE}</p>
      </PopoverDescription>
      <p className="mt-1.5 text-xs text-muted-foreground">{COPY_NOTE}</p>
    </PopoverContent>
  </Popover>;
}

/** The compact completeness meter: a 40 px brand ring, «n de 10» and only the NEXT missing item. */
function Meter({ completeness, onGoto }: { completeness: Completeness; onGoto: (key: KeyDataKey) => void }) {
  const { completed, total, percentage, items } = completeness;
  const next = items.find(item => !item.done);
  return <div data-pf-profile-meter="" className="flex min-w-0 items-center gap-3">
    <Ring value={completed} total={total} size={40} stroke={4} brand label={`Perfil completo al ${percentage} %`}>
      {next ? null : <Check className="size-4 text-primary-text" strokeWidth={2.75} />}
    </Ring>
    <div className="min-w-0">
      <b className="block text-[15px] leading-5 font-semibold tabular-nums">{completed} de {total}</b>
      {next
        ? <button type="button" onClick={() => onGoto(next.key)} className="inline-flex min-h-6 items-center rounded-sm text-left text-[13px] leading-[18px] font-medium text-primary-text underline-offset-3 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">{NEXT_STEP[next.key]}</button>
        : <span className="block text-[13px] leading-[18px] text-muted-foreground">Perfil completo</span>}
    </div>
  </div>;
}

/**
 * The light identity card (artboard 01): brand-tinted banner, initials overlapping it, name, the professional title as
 * a small badge, Ubicación and Experiencia tiles, six skills with «+N más», then the meter and «¿Qué ve una empresa?».
 * Below `sm` it turns compact: the avatar sits beside the name, the tiles stay and the skills hide.
 */
export function IdentityCard({ fullName, draft, baseline, completeness, onGoto }: {
  fullName: string; draft: CandidateProfileDraft; baseline: ProfileBaseline; completeness: Completeness; onGoto: (key: KeyDataKey) => void;
}) {
  const nameId = useId(), skillsId = useId();
  const [allSkills, setAllSkills] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const initials = fullName.split(/\s+/u).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  const title = draft.professionalTitle.trim();
  const experience = [yearsText(draft.yearsOfExperience), draft.seniority ? SENIORITY_LABELS[draft.seniority] : ""].filter(Boolean).join(" · ");
  const skills = skillList(draft.skills);
  const hidden = skills.length - SKILLS_SHOWN;
  return <article aria-labelledby={nameId} data-pf-profile-identity="" style={{ "--d": 1 } as CSSProperties}
    className={cn("flex min-w-0 flex-col overflow-hidden rounded-[min(var(--radius-4xl),24px)] bg-card text-sm text-card-foreground shadow-sm ring-1 ring-foreground/5 dark:ring-foreground/10", styles.rise)}>
    <div aria-hidden="true" className={cn("h-12 sm:h-[88px]", styles.banner)} />
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3.5 px-4 pb-4 sm:flex sm:flex-col sm:px-5 sm:pb-5">
      <span aria-hidden="true" className={cn("row-span-2 -mt-5 grid size-14 place-items-center rounded-[18px] text-[19px] font-semibold tracking-tight text-primary-text sm:-mt-9 sm:size-[72px] sm:rounded-[22px] sm:text-2xl", styles.avatar)}>{initials}</span>
      <h3 id={nameId} className="mt-2 min-w-0 text-lg leading-6 font-semibold tracking-tight [overflow-wrap:anywhere] sm:mt-3 sm:text-xl sm:leading-7">{fullName}</h3>
      {title && <p className="col-start-2 mt-1 flex min-w-0"><Badge variant="accent" className="h-auto min-h-[22px] max-w-full border-primary/20 bg-[color-mix(in_oklab,var(--primary)_9%,var(--card))] py-0.5 text-left whitespace-normal">{title}</Badge></p>}
      <ul aria-label="Datos principales" className="col-span-2 mt-3.5 grid grid-cols-2 gap-2 sm:mt-5 sm:w-full">
        <li className={TILE}><span className={TILE_LABEL}><MapPin aria-hidden="true" className="size-3.5" />Ubicación</span>
          {draft.location.country === null ? <span className="mt-1 block text-muted-foreground">Sin dato</span> : <span className="mt-1 block font-medium [overflow-wrap:anywhere]"><LocationText draft={draft} baseline={baseline} /></span>}</li>
        <li className={TILE}><span className={TILE_LABEL}><BriefcaseBusiness aria-hidden="true" className="size-3.5" />Experiencia</span>
          {experience ? <span className="mt-1 block font-medium [overflow-wrap:anywhere]">{experience}</span> : <span className="mt-1 block text-muted-foreground">Sin dato</span>}</li>
      </ul>
      {skills.length > 0 && <div data-pf-profile-skills="" className="col-span-2 mt-5 max-sm:hidden sm:w-full">
        <p id={skillsId} className="mb-2 text-xs font-medium text-muted-foreground">Habilidades</p>
        <ul aria-labelledby={skillsId} className="flex flex-wrap gap-1.5">
          {(allSkills ? skills : skills.slice(0, SKILLS_SHOWN)).map((skill, index) => <li key={`${skill}-${index}`} className="inline-flex min-h-[22px] items-center rounded-full bg-card px-2 py-[3px] text-xs leading-4 font-medium ring-1 ring-border ring-inset">{skill}</li>)}
          {hidden > 0 && <li><button ref={more} type="button" aria-expanded={allSkills} onClick={() => { setAllSkills(value => !value); more.current?.focus(); }}
            className="inline-flex min-h-6 items-center rounded-full px-1.5 text-xs font-medium text-primary-text underline-offset-3 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">{allSkills ? "Ver menos" : `+${hidden} más`}</button></li>}
        </ul>
      </div>}
    </div>
    <div className="flex min-w-0 flex-col gap-0.5 border-t border-border px-4 pt-3 pb-2 sm:px-5 sm:pt-3.5 sm:pb-3">
      <Meter completeness={completeness} onGoto={onGoto} />
      <CompanyView />
    </div>
  </article>;
}

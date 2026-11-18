"use client";

import { useId, type CSSProperties } from "react";
import { Building2, Globe, Link2, Mail, MapPin, Phone, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SENIORITY_LABELS } from "../model";
import type { CandidateProfileDraft, ProfileBaseline } from "../profile-draft";
import { highestLevel, levelText, phoneText, urlText, yearsText } from "./format";
import { LocationText } from "./section-read";
import { visibleToCompany } from "./visibility";
import styles from "./profile.module.css";

export const FICHA_LABEL = "Así te ve una empresa al recibir tu postulación";
const PILL = "inline-flex min-h-9 max-w-full min-w-0 items-center gap-2 rounded-full bg-card px-3.5 text-[13px] font-medium ring-1 ring-border ring-inset max-sm:min-h-10";
const ADD = "inline-flex min-h-9 items-center gap-2 rounded-full border border-dashed border-border px-3.5 text-[13px] font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none max-sm:min-h-10";

/**
 * The ficha: ONLY what a company receives when the candidate applies, every fact gated by the visibility map.
 * Private facts (current company, links, birth date, summary, study details, compensation) never appear here.
 */
export function ProfileFicha({ fullName, email, draft, baseline, onEdit }: {
  fullName: string; email: string; draft: CandidateProfileDraft; baseline: ProfileBaseline;
  onEdit: (section: "experience" | "personal", focus: string) => void;
}) {
  const id = useId();
  const initials = fullName.split(/\s+/u).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  const title = draft.professionalTitle.trim();
  const company = draft.currentCompany.trim();
  const phone = phoneText(draft);
  const located = visibleToCompany("location") && draft.location.country !== null;
  const highest = highestLevel(draft.education);
  const facts = [
    visibleToCompany("yearsOfExperience") && draft.yearsOfExperience.trim() ? `${yearsText(draft.yearsOfExperience)} de experiencia` : "",
    visibleToCompany("seniority") && draft.seniority ? SENIORITY_LABELS[draft.seniority] : "",
    visibleToCompany("educationLevel") && highest ? levelText(highest) : "",
  ].filter(Boolean);
  return <article aria-labelledby={id} data-pf-profile-ficha="" style={{ "--d": 1 } as CSSProperties}
    className={cn("flex min-w-0 flex-col gap-4 overflow-hidden rounded-[min(var(--radius-4xl),24px)] px-4 pt-5 pb-5 text-sm text-card-foreground shadow-sm ring-1 ring-foreground/5 sm:px-9 sm:pt-8 sm:pb-7 dark:ring-foreground/10", styles.ficha, styles.rise)}>
    <p id={id} className="flex items-center gap-2 text-[11px] leading-4 font-semibold tracking-[0.06em] text-primary-text uppercase sm:text-xs"><span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />{FICHA_LABEL}</p>
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3.5 gap-y-0.5 sm:gap-x-5.5 sm:gap-y-1">
      <span aria-hidden="true" data-pf-profile-avatar="" className="row-span-2 grid size-14 place-items-center rounded-[18px] bg-[color-mix(in_oklab,var(--primary)_12%,var(--card))] text-[19px] font-semibold tracking-tight text-primary-text ring-1 ring-primary/20 ring-inset sm:row-span-3 sm:size-20 sm:rounded-3xl sm:text-[26px]">{initials}</span>
      {visibleToCompany("fullName") && <h3 className="min-w-0 text-[22px] leading-7 font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-[28px] sm:leading-9">{fullName}</h3>}
      {visibleToCompany("professionalTitle") && (title
        ? <p data-pf-profile-headline="" className="min-w-0 text-sm leading-5 font-medium break-words sm:text-base sm:leading-6">{title}</p>
        : <Button type="button" variant="link" className="h-auto min-h-8 justify-self-start px-0 text-muted-foreground has-data-[icon=inline-start]:pl-0" onClick={() => onEdit("experience", "professionalTitle")}><Plus data-icon="inline-start" aria-hidden="true" />Agrega tu título profesional</Button>)}
      <p className="col-span-2 mt-2.5 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground sm:col-span-1 sm:col-start-2 sm:mt-0 sm:text-sm">
        {located && <span className="inline-flex min-w-0 items-center gap-1.5 [overflow-wrap:anywhere]"><MapPin aria-hidden="true" className="size-3.5 shrink-0" /><LocationText draft={draft} baseline={baseline} /></span>}
        {visibleToCompany("currentCompany") && company && <span className="inline-flex min-w-0 items-center gap-1.5 [overflow-wrap:anywhere]"><Building2 aria-hidden="true" className="size-3.5 shrink-0" />Trabaja en {company}</span>}
        {facts.length > 0 && <span data-pf-profile-facts="" className="min-w-0 break-words">{facts.join(" · ")}</span>}
        {!located && facts.length === 0 && <span>Sin ubicación ni experiencia todavía</span>}
      </p>
    </div>
    <ul aria-label="Contacto que recibe la empresa" className="flex min-w-0 flex-wrap gap-2">
      {visibleToCompany("email") && <li className={PILL} title="Correo de tu cuenta"><Mail aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 truncate">{email}</span></li>}
      {visibleToCompany("phone") && phone && <li className={PILL}><Phone aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 truncate">{phone}</span></li>}
      {visibleToCompany("linkedinUrl") && draft.linkedinUrl.trim() && <li className={PILL}><Link2 aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 truncate">LinkedIn</span></li>}
      {visibleToCompany("portfolioUrl") && draft.portfolioUrl.trim() && <li className={PILL}><Globe aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 truncate">{urlText(draft.portfolioUrl)}</span></li>}
      {visibleToCompany("phone") && !phone && <li><button type="button" className={ADD} onClick={() => onEdit("personal", "phone")}><Plus aria-hidden="true" className="size-3.5" />Agregar contacto</button></li>}
    </ul>
  </article>;
}

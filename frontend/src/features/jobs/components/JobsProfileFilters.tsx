"use client";

import { GraduationCapIcon, LanguagesIcon, TrendingUpIcon, UserRoundIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EDUCATION_LEVELS, EDUCATION_LEVEL_LABELS, SENIORITIES, SENIORITY_LABELS, yearsOfExperienceSchema } from "@/features/candidate/model";
import type { useLanguageCatalog } from "@/features/languages/use-language-catalog";
import { selectedValues, type JobsFilterPatch, type JobsQuery } from "../url";
import { CatalogFeedback, MultiFilter } from "./JobsGeoFilters";

type Languages = ReturnType<typeof useLanguageCatalog>;
export const CLEAR_PROFILE_FILTERS = { language: [], seniority: [], years_of_experience: "", education_level: "" } as const;
export type ProfileErrors = { years_of_experience?: string };
export function validateProfileFilters(query: JobsQuery): ProfileErrors {
  return query.years_of_experience && !yearsOfExperienceSchema.safeParse(query.years_of_experience).success
    ? { years_of_experience: "Escribe de 0 a 60 años, con hasta un decimal y sin signos ni ceros iniciales." } : {};
}
const seniorities = SENIORITIES.map(value => ({ id: value, name: SENIORITY_LABELS[value] }));
const education = [{ value: null, label: "Todos los niveles" }, ...EDUCATION_LEVELS.map(value => ({ value, label: EDUCATION_LEVEL_LABELS[value] }))];

/** Candidate-owned capabilities, not requested vacancy minima. Apply commits both surfaces. */
export function JobsProfileFilters({ idPrefix, query, onChange, languages, errors }: { idPrefix: string; query: JobsQuery; onChange: (patch: JobsFilterPatch) => void; languages: Languages; errors: ProfileErrors }) {
  const yearsId = `${idPrefix}years_of_experience`;
  return <FieldSet>
    <FieldLegend variant="label"><UserRoundIcon aria-hidden="true" className="inline size-4" /> Tu perfil</FieldLegend>
    <FieldGroup>
      <MultiFilter id={`${idPrefix}language`} label="Idiomas" options={(languages.data?.items ?? []).map(item => ({ id: item.code, name: item.name }))} value={selectedValues(query.language)} onChange={language => onChange({ language })} helper="Vacantes que piden alguno de estos idiomas." />
      <CatalogFeedback resource={languages} label="idiomas" />
      <MultiFilter id={`${idPrefix}seniority`} label="Seniority" options={seniorities} value={selectedValues(query.seniority)} onChange={seniority => onChange({ seniority })} />
      <Field data-invalid={Boolean(errors.years_of_experience)}>
        <FieldLabel htmlFor={yearsId}>Tus años de experiencia</FieldLabel>
        <Input id={yearsId} name="years_of_experience" inputMode="decimal" className="min-h-10" value={query.years_of_experience ?? ""} onChange={event => onChange({ years_of_experience: event.target.value })} aria-invalid={Boolean(errors.years_of_experience)} aria-describedby={`${yearsId}-help${errors.years_of_experience ? ` ${yearsId}-error` : ""}`} />
        <FieldDescription id={`${yearsId}-help`}>Vacantes cuyo mínimo de experiencia cumples o que no piden un mínimo.</FieldDescription>
        {errors.years_of_experience && <FieldError id={`${yearsId}-error`}>{errors.years_of_experience}</FieldError>}
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}education_level`}>Tu nivel de estudios</FieldLabel>
        <Select name="education_level" items={education} value={query.education_level || null} onValueChange={value => onChange({ education_level: value ?? "" })}>
          <SelectTrigger id={`${idPrefix}education_level`} className="min-h-10 w-full" aria-describedby={`${idPrefix}education-help`}><SelectValue placeholder="Todos los niveles" /></SelectTrigger>
          <SelectContent className="min-w-max"><SelectGroup>{education.map(item => <SelectItem key={item.label} value={item.value} className="min-h-10">{item.label}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
        <FieldDescription id={`${idPrefix}education-help`}>Vacantes cuyo mínimo de estudios cumples o que no piden un mínimo.</FieldDescription>
      </Field>
    </FieldGroup>
  </FieldSet>;
}

export function JobsProfileFilterChips({ query, languages, onRemove }: { query: JobsQuery; languages: Languages; onRemove: (patch: JobsFilterPatch) => void }) {
  const dimensions = [
    { key: "language", label: "Idiomas", icon: LanguagesIcon, options: (languages.data?.items ?? []).map(item => ({ id: item.code, name: item.name })), multiple: true },
    { key: "seniority", label: "Seniority", icon: TrendingUpIcon, options: seniorities, multiple: true },
    { key: "years_of_experience", label: "Tus años de experiencia", icon: UserRoundIcon, options: query.years_of_experience ? [{ id: query.years_of_experience, name: query.years_of_experience }] : [], multiple: false },
    { key: "education_level", label: "Tu nivel de estudios", icon: GraduationCapIcon, options: EDUCATION_LEVELS.map(id => ({ id, name: EDUCATION_LEVEL_LABELS[id] })), multiple: false },
  ] as const;
  return dimensions.flatMap(({ key, label, icon: Icon, options, multiple }) => selectedValues(query[key]).map(value => {
    const text = `${label}: ${options.find(item => item.id === value)?.name ?? "Nombre no disponible"}`;
    return <Tooltip key={`${key}-${value}`}>
      <TooltipTrigger render={<Button type="button" variant="outline" className="h-8 max-w-[300px] shrink-0" aria-label={`Quitar filtro ${text}`} onClick={() => onRemove({ [key]: multiple ? selectedValues(query[key]).filter(item => item !== value) : "" })} />}>
        <Icon aria-hidden="true" data-icon="inline-start" /><span className="min-w-0 truncate">{text}</span><XIcon aria-hidden="true" data-icon="inline-end" />
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>;
  }));
}

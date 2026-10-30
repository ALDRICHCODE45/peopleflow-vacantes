"use client";
import { Fragment, type ReactNode } from "react";
import { GraduationCap, Trash2 } from "lucide-react";
import { SectionEmpty } from "@/components/feedback/state-card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EDUCATION_LEVELS, EDUCATION_LEVEL_LABELS, EDUCATION_STATUSES, EDUCATION_STATUS_LABELS } from "./model";
import type { EducationDraft, ProfileDraftIssue } from "./profile-draft";
const labels = { level: "Nivel", institution: "Institución", field: "Carrera o campo", status: "Estatus", start_year: "Año de inicio", end_year: "Año de fin" } as const;
const keys = Object.keys(labels) as (keyof EducationDraft)[];
const options = { level: EDUCATION_LEVELS.map(value => ({ value, label: EDUCATION_LEVEL_LABELS[value] })), status: EDUCATION_STATUSES.map(value => ({ value, label: EDUCATION_STATUS_LABELS[value] })) };
export function EducationFields({ value, onChange, issues, disabled, embedded = false, requiredMarker }: { value: readonly EducationDraft[]; onChange: (value: EducationDraft[]) => void; issues: readonly ProfileDraftIssue[]; disabled?: boolean; embedded?: boolean; requiredMarker?: ReactNode }) {
  const addStudy = () => onChange([...value, { level: "", institution: "", field: "", status: "", start_year: "", end_year: "" }]);
  const errorFor = (path: string) => issues.find(issue => issue.path === path)?.message;
  const fields = <FieldSet data-pf-profile-group="education" disabled={disabled} className="gap-4">
      <FieldLegend className="sr-only">Formación académica</FieldLegend>
      {errorFor("education") && <FieldError>{errorFor("education")}</FieldError>}
      {value.length === 0 && <SectionEmpty icon={GraduationCap} tone="empty" title="Todavía no agregas tus estudios"
        description="Comparte tu formación para que las empresas conozcan tu perfil. Puedes agregar estudios terminados o en curso."
        primaryAction={{ label: "Agregar estudio", disabled, onClick: addStudy }} />}
      <FieldGroup>{value.map((study, index) => <Fragment key={index}>
        {index > 0 && <Separator />}
        <FieldSet className="gap-4">
        <FieldLegend className="sr-only">Estudio {index + 1}</FieldLegend>
        <div className="flex items-center justify-between gap-3">
          <span aria-hidden="true" className="text-sm font-medium">Estudio {index + 1}</span>
          <Button type="button" variant="ghost" className="min-h-10 text-destructive hover:text-destructive" aria-label={`Quitar estudio ${index + 1}`} disabled={disabled} onClick={() => onChange(value.filter((_, i) => i !== index))}><Trash2 data-icon="inline-start" aria-hidden="true" />Quitar</Button>
        </div>
        <FieldGroup data-pf-profile-fields-grid="" className="grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*]:min-w-0">{keys.map(key => {
          if (key === "end_year" && study.status === "in_progress") return null;
          const path = `education.${index}.${key}`;
          const id = `profile-education-${index}-${key}`;
          const error = errorFor(path);
          const update = (next: string) => onChange(value.map((row, i) => i === index ? { ...row, [key]: next, ...(key === "status" && next === "in_progress" ? { end_year: "" } : {}) } : row));
          // Level and status are required for every study: ask to choose, never offer «Sin especificar».
          const items = key === "level" || key === "status" ? options[key] : null;
          const year = key === "start_year" || key === "end_year";
          const aria = { id, "data-pf-profile-field": path, "aria-invalid": !!error, "aria-describedby": error ? `${id}-error` : undefined };
          return <Field key={key} data-invalid={!!error}><FieldLabel htmlFor={id}>{labels[key]}{items && requiredMarker}</FieldLabel>
            {items ? <Select items={items} value={study[key] || null} disabled={disabled} onValueChange={next => update(next ?? "")}>
              <SelectTrigger {...aria} className="min-h-10 w-full"><SelectValue placeholder={key === "level" ? "Elige un nivel" : "Elige un estatus"} /></SelectTrigger>
              <SelectContent><SelectGroup>{items.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
            </Select> : <InputGroup className="min-h-10"><InputGroupInput {...aria} className="min-h-10" type={year ? "number" : "text"} min={year ? 1950 : undefined} max={year ? 2100 : undefined} step={year ? 1 : undefined} value={study[key]} disabled={disabled} onChange={event => update(event.target.value)} /></InputGroup>}
            {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
          </Field>;
        })}</FieldGroup>
      </FieldSet></Fragment>)}</FieldGroup>
      {value.length > 0 && <Button type="button" variant="outline" data-pf-profile-education-add className="min-h-10 w-fit" disabled={disabled || value.length >= 10} onClick={addStudy}>Agregar estudio</Button>}
    </FieldSet>;
  if (embedded) return fields;
  return <Card size="sm" data-pf-profile-section-card="" className="shadow-none ring-border/70">
    <CardHeader className="border-b"><CardTitle aria-hidden="true"><h3>Formación académica</h3></CardTitle></CardHeader>
    <CardContent className="flex flex-col gap-4">{fields}</CardContent>
  </Card>;
}

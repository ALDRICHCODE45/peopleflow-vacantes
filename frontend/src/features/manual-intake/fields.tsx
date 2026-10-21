"use client";
import type { ReactNode } from "react";
import { BriefcaseBusiness, ContactRound, FileText, GraduationCap, MapPin, Route, type LucideIcon } from "lucide-react";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { LocationField } from "@/features/geo/location-field";
import { CEFR_LEVELS, CEFR_LEVEL_LABELS, EDUCATION_LEVELS, EDUCATION_LEVEL_LABELS } from "@/features/candidate/model";
import type { Board } from "@/features/pipeline-movement/model";
import type { Draft, Errors } from "./draft";

function Section({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
 return <FieldSet><FieldLegend className="text-xs uppercase tracking-wide text-muted-foreground"><span className="flex items-center gap-2"><Icon className="size-4" aria-hidden="true" />{title}</span></FieldLegend><FieldGroup>{children}</FieldGroup></FieldSet>;
}
export function Choice({ name, label, value, options, onChange, error }: { name: string; label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; error?: string }) {
 const id = `intake-${name}`;
 return <Field data-invalid={!!error}><FieldLabel htmlFor={id}>{label}</FieldLabel><Select items={options} value={value || null} onValueChange={next => onChange(next ?? "")}><SelectTrigger id={id} className="min-h-10 w-full" aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}><SelectValue placeholder="Elige una opción" /></SelectTrigger><SelectContent><SelectGroup>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent></Select>{error && <FieldError id={`${id}-error`}>{error}</FieldError>}</Field>;
}
/** ProfileFormFields owns Card surfaces (and private scalar helpers); this Sheet
 * composes the same labels/vocabularies without nesting Cards inside a modal. */
export function IntakeFields({ draft, onChange, errors, stages, stage, onStage, existing, file, onFile, onContactBlur }: { draft: Draft; onChange: (draft: Draft) => void; errors: Errors; stages: Board["stages"]; stage: string; onStage: (value: string) => void; existing: boolean; file: File | null; onFile: (file: File | null) => void; onContactBlur: () => void }) {
 const scalar = (name: Exclude<keyof Draft, "residence" | "languages">, label: string, type = "text", multiline = false) => {
  const id = `intake-${name}`; const error = errors[name];
  const props = { id, value: draft[name], className: "min-h-10", "aria-invalid": !!error, "aria-describedby": error ? `${id}-error` : undefined, onChange: (event: { target: { value: string } }) => onChange({ ...draft, [name]: event.target.value }), onBlur: name === "email" || name === "phone" ? onContactBlur : undefined };
  return <Field data-invalid={!!error}><FieldLabel htmlFor={id}>{label}</FieldLabel>{multiline ? <Textarea {...props} /> : <Input {...props} type={type} {...(name === "experience_years" ? { min: 0, max: 60, step: 1 } : {})} />}{error && <FieldError id={`${id}-error`}>{error}</FieldError>}</Field>;
 };
 return <FieldGroup>
  <Section title="Etapa" icon={Route}><Choice name="stage_id" label="Etapa de ingreso" value={stage} onChange={onStage} error={errors.stage_id} options={stages.filter(value => value.kind !== "placement").map(value => ({ value: value.id, label: value.name }))} /></Section>
  {!existing && <><Separator /><Section title="Datos de contacto" icon={ContactRound}>
    {scalar("full_name", "Nombre completo")}
    <FieldDescription>Agrega al menos un correo o un teléfono; puedes incluir ambos.</FieldDescription>
    {scalar("email", "Correo electrónico", "email")}
    <FieldGroup className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">{scalar("dial", "Lada de país", "tel")}{scalar("phone", "Teléfono", "tel")}</FieldGroup>
    <FieldDescription>México: +52 y 10 dígitos. Otros países: lada y entre 6 y 14 dígitos.</FieldDescription>
  </Section><Separator /><Section title="Residencia" icon={MapPin}>
    <LocationField label="Residencia" hideLegend value={draft.residence} onChange={residence => onChange({ ...draft, residence })} depth="municipality" postalCode defaultCountry={null} required={draft.residence.country === "MX" ? ["country", "state", "municipality"] : ["country"]}
      errors={Object.keys(errors).filter(key => key.startsWith("residence.")).map(key => ({ field: key.slice(10), reason: errors[key] === "Revisa este dato." ? "unknown" as const : errors[key] === "Este dato no se permite aquí." ? "not_allowed" as const : "required" as const }))} />
  </Section><Separator /><Section title="Formación" icon={GraduationCap}>
    <Choice name="education_level" label="Nivel máximo de estudios" value={draft.education_level} error={errors.education_level} onChange={education_level => onChange({ ...draft, education_level })} options={EDUCATION_LEVELS.map(value => ({ value, label: EDUCATION_LEVEL_LABELS[value] }))} />
  </Section><Separator /><Section title="Perfil profesional" icon={BriefcaseBusiness}>
    <FieldDescription>Estos datos son opcionales.</FieldDescription>
    {scalar("professional_title", "Título profesional")}{scalar("current_company", "Empresa actual o última")}{scalar("field_of_study", "Campo de estudio")}{scalar("experience_years", "Años de experiencia", "number")}{scalar("summary", "Resumen profesional", "text", true)}{scalar("skills", "Habilidades", "text", true)}
    <FieldDescription>Separa las habilidades con comas o saltos de línea. Máximo 30.</FieldDescription>
    {errors.languages && <FieldError id="intake-languages-error">{errors.languages}</FieldError>}
    {draft.languages.map((row, index) => <FieldSet key={index}><FieldLegend variant="label">Idioma {index + 1}</FieldLegend><FieldGroup>
      <Field data-invalid={!!errors[`languages[${index}].language`]}><FieldLabel htmlFor={`language-${index}`}>Nombre del idioma {index + 1}</FieldLabel><Input id={`language-${index}`} className="min-h-10" value={row.language} aria-invalid={!!errors[`languages[${index}].language`]} aria-describedby={errors[`languages[${index}].language`] ? `language-${index}-error` : undefined} onChange={event => onChange({ ...draft, languages: draft.languages.map((item, i) => i === index ? { ...item, language: event.target.value } : item) })} />{errors[`languages[${index}].language`] && <FieldError id={`language-${index}-error`}>{errors[`languages[${index}].language`]}</FieldError>}</Field>
      <Choice name={`languages[${index}].level`} label={`Nivel del idioma ${index + 1}`} value={row.level} error={errors[`languages[${index}].level`]} onChange={level => onChange({ ...draft, languages: draft.languages.map((item, i) => i === index ? { ...item, level } : item) })} options={CEFR_LEVELS.map(value => ({ value, label: `${value} · ${CEFR_LEVEL_LABELS[value]}` }))} />
      <Button type="button" variant="ghost" className="min-h-10 w-fit" onClick={() => onChange({ ...draft, languages: draft.languages.filter((_, i) => i !== index) })}>Quitar idioma {index + 1}</Button>
    </FieldGroup></FieldSet>)}
    <Button type="button" variant="outline" className="min-h-10 w-fit" aria-invalid={!!errors.languages} aria-describedby={errors.languages ? "intake-languages-error" : undefined} disabled={draft.languages.length >= 10} onClick={() => onChange({ ...draft, languages: [...draft.languages, { language: "", level: "" }] })}>Agregar idioma</Button>
    {scalar("linkedin_url", "Perfil de LinkedIn", "url")}{scalar("portfolio_url", "Portafolio o sitio web", "url")}
  </Section></>}
  <Separator /><Section title="CV" icon={FileText}><Field data-invalid={!!errors.cv}><FieldLabel htmlFor="intake-cv">CV</FieldLabel><Input id="intake-cv" type="file" className="min-h-10" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" aria-invalid={!!errors.cv} aria-describedby="intake-cv-help intake-cv-error" onChange={event => onFile(event.target.files?.[0] ?? null)} /><FieldDescription id="intake-cv-help">Obligatorio. PDF o Word (.docx), máximo 5 MB.{file ? ` Seleccionado: ${file.name}` : ""}</FieldDescription>{errors.cv && <FieldError id="intake-cv-error">{errors.cv}</FieldError>}</Field></Section>
 </FieldGroup>;
}

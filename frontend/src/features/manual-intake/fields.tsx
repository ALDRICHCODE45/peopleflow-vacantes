"use client";
import { useRef, useState, type ReactNode } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatApplicationCvSize } from "@/features/jobs/application/application-cv";
import { Upload, ContactRound, FileText, GraduationCap, MapPin, Route, type LucideIcon } from "lucide-react";
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

const profileKeys = ["professional_title", "current_company", "field_of_study", "experience_years", "summary", "skills", "linkedin_url", "portfolio_url"] as const;
function Required() { return <span aria-hidden="true" className="text-primary"> *</span>; }
function dataCount(count: number) { return `${count} ${count === 1 ? "dato" : "datos"}`; }
function Section({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
 return <FieldSet><FieldLegend className="text-xs uppercase tracking-wide text-muted-foreground"><span className="flex items-center gap-2"><Icon className="size-4" aria-hidden="true" />{title}</span></FieldLegend><FieldGroup>{children}</FieldGroup></FieldSet>;
}
export function Choice({ name, label, value, options, onChange, error }: { name: string; label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; error?: string }) {
 const id = `intake-${name}`;
 return <Field data-invalid={!!error}><FieldLabel htmlFor={id}>{label}{["stage_id", "education_level"].includes(name) && <Required />}</FieldLabel><Select items={options} value={value || null} onValueChange={next => onChange(next ?? "")}><SelectTrigger id={id} className="min-h-10 w-full" aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}><SelectValue placeholder="Elige una opción" /></SelectTrigger><SelectContent><SelectGroup>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent></Select>{error && <FieldError id={`${id}-error`}>{error}</FieldError>}</Field>;
}
/** ProfileFormFields owns Card surfaces (and private scalar helpers); this Sheet
 * composes the same labels/vocabularies without nesting Cards inside a modal. */
export function IntakeFields({ draft, onChange, errors, stages, stage, onStage, existing, file, onFile, onContactBlur }: { draft: Draft; onChange: (draft: Draft) => void; errors: Errors; stages: Board["stages"]; stage: string; onStage: (value: string) => void; existing: boolean; file: File | null; onFile: (file: File | null) => void; onContactBlur: () => void }) {
 const fileInput = useRef<HTMLInputElement>(null);
 const [profileOpen, setProfileOpen] = useState<string[]>([]);
 const profileInvalid = Object.keys(errors).some(key => profileKeys.some(name => key === name) || key.startsWith("languages"));
 const filled = profileKeys.filter(key => draft[key].trim()).length + (draft.languages.some(row => row.language.trim() || row.level) ? 1 : 0);
 const scalar = (name: Exclude<keyof Draft, "residence" | "languages">, label: string, type = "text", multiline = false) => {
  const id = `intake-${name}`; const error = errors[name];
  const props = { id, value: draft[name], className: "min-h-10", "aria-invalid": !!error || ((name === "email" || name === "phone") && !!errors.contact), "aria-describedby": (name === "email" || name === "phone") && errors.contact ? "intake-contact-error" : error ? `${id}-error` : undefined, onChange: (event: { target: { value: string } }) => onChange({ ...draft, [name]: event.target.value }), onBlur: name === "email" || name === "phone" ? onContactBlur : undefined };
  return <Field data-invalid={props["aria-invalid"]}><FieldLabel htmlFor={id}>{label}{["full_name", "email", "phone"].includes(name) && <Required />}</FieldLabel>{multiline ? <Textarea {...props} /> : <Input {...props} type={type} {...(name === "experience_years" ? { min: 0, max: 60, step: 1 } : {})} />}{error && <FieldError id={`${id}-error`}>{error}</FieldError>}</Field>;
 };
 return <FieldGroup>
  <Section title="Etapa" icon={Route}><Choice name="stage_id" label="Etapa de ingreso" value={stage} onChange={onStage} error={errors.stage_id} options={stages.filter(value => value.kind !== "placement").map(value => ({ value: value.id, label: value.name }))} /></Section>
  {!existing && <><Separator /><Section title="Datos de contacto" icon={ContactRound}>
    {scalar("full_name", "Nombre completo")}
    <FieldDescription>Agrega al menos un correo o un teléfono; puedes incluir ambos.</FieldDescription>
    {scalar("email", "Correo electrónico", "email")}
    <FieldGroup className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">{scalar("dial", "Lada de país", "tel")}{scalar("phone", "Teléfono", "tel")}</FieldGroup>
    {errors.contact && <FieldError id="intake-contact-error">{errors.contact}</FieldError>}
    <FieldDescription>México: +52 y 10 dígitos. Otros países: lada y número, de 8 a 15 dígitos en total.</FieldDescription>
  </Section><Separator /><Section title="Residencia" icon={MapPin}>
    <LocationField requiredIndicator={<Required />} label="Residencia" hideLegend value={draft.residence} onChange={residence => onChange({ ...draft, residence })} depth="municipality" postalCode defaultCountry={null} required={draft.residence.country === "MX" ? ["country", "state", "municipality"] : ["country"]}
      errors={Object.keys(errors).filter(key => key.startsWith("residence.")).map(key => ({ field: key.slice(10), message: errors[key], reason: errors[key] === "Revisa este dato." ? "unknown" as const : errors[key] === "Este dato no se permite aquí." ? "not_allowed" as const : "required" as const }))} />
  </Section><Separator /><Section title="Formación" icon={GraduationCap}>
    <Choice name="education_level" label="Nivel máximo de estudios" value={draft.education_level} error={errors.education_level} onChange={education_level => onChange({ ...draft, education_level })} options={EDUCATION_LEVELS.map(value => ({ value, label: EDUCATION_LEVEL_LABELS[value] }))} />
  </Section><Separator /><Accordion value={profileInvalid ? ["profile"] : profileOpen} onValueChange={setProfileOpen}><AccordionItem value="profile"><AccordionTrigger>Perfil profesional (opcional){filled > 0 && <Badge variant="secondary">{dataCount(filled)}</Badge>}</AccordionTrigger><AccordionContent><FieldGroup>
    {scalar("professional_title", "Título profesional")}{scalar("current_company", "Empresa actual o última")}{scalar("field_of_study", "Campo de estudio")}{scalar("experience_years", "Años de experiencia", "number")}{scalar("summary", "Resumen profesional", "text", true)}{scalar("skills", "Habilidades", "text", true)}
    <FieldDescription>Separa las habilidades con comas o saltos de línea. Máximo 30.</FieldDescription>
    <FieldSet><FieldLegend variant="label">Idiomas</FieldLegend><FieldGroup>
    {!draft.languages.length && <FieldDescription>Sin idiomas agregados.</FieldDescription>}
    {errors.languages && <FieldError id="intake-languages-error">{errors.languages}</FieldError>}
    {draft.languages.map((row, index) => <FieldSet key={index}><FieldLegend variant="label">Idioma {index + 1}</FieldLegend><FieldGroup>
      <Field data-invalid={!!errors[`languages[${index}].language`]}><FieldLabel htmlFor={`language-${index}`}>Nombre del idioma {index + 1}</FieldLabel><Input id={`language-${index}`} className="min-h-10" value={row.language} aria-invalid={!!errors[`languages[${index}].language`]} aria-describedby={errors[`languages[${index}].language`] ? `language-${index}-error` : undefined} onChange={event => onChange({ ...draft, languages: draft.languages.map((item, i) => i === index ? { ...item, language: event.target.value } : item) })} />{errors[`languages[${index}].language`] && <FieldError id={`language-${index}-error`}>{errors[`languages[${index}].language`]}</FieldError>}</Field>
      <Choice name={`languages[${index}].level`} label={`Nivel del idioma ${index + 1}`} value={row.level} error={errors[`languages[${index}].level`]} onChange={level => onChange({ ...draft, languages: draft.languages.map((item, i) => i === index ? { ...item, level } : item) })} options={CEFR_LEVELS.map(value => ({ value, label: `${value} · ${CEFR_LEVEL_LABELS[value]}` }))} />
      <Button type="button" variant="ghost" className="min-h-10 w-fit" onClick={() => onChange({ ...draft, languages: draft.languages.filter((_, i) => i !== index) })}>Quitar idioma {index + 1}</Button>
    </FieldGroup></FieldSet>)}
    <Button type="button" variant="outline" className="min-h-10 w-fit" aria-invalid={!!errors.languages} aria-describedby={errors.languages ? "intake-languages-error" : undefined} disabled={draft.languages.length >= 10} onClick={() => onChange({ ...draft, languages: [...draft.languages, { language: "", level: "" }] })}>Agregar idioma</Button></FieldGroup></FieldSet>
    {scalar("linkedin_url", "Perfil de LinkedIn", "url")}{scalar("portfolio_url", "Portafolio o sitio web", "url")}
  </FieldGroup></AccordionContent></AccordionItem></Accordion></>}
  <Separator /><Section title="CV" icon={FileText}><Field data-invalid={!!errors.cv}><FieldLabel htmlFor="intake-cv">CV<Required /></FieldLabel><input ref={fileInput} id="intake-cv" type="file" className="sr-only" tabIndex={-1} accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={event => { const selected = event.target.files?.[0]; if (selected) onFile(selected); event.target.value = ""; }} />
   {file ? <Item variant="outline" className="min-w-0 flex-wrap"><ItemMedia variant="icon"><FileText aria-hidden="true" /></ItemMedia><ItemContent className="min-w-0 flex-1 basis-40"><ItemTitle className="w-full min-w-0"><Tooltip><TooltipTrigger render={<span tabIndex={0} className="block truncate" />}>{file.name}</TooltipTrigger><TooltipContent>{file.name}</TooltipContent></Tooltip></ItemTitle><ItemDescription>{formatApplicationCvSize(file.size)}</ItemDescription></ItemContent><ItemActions><Button type="button" variant="outline" className="min-h-10" aria-invalid={!!errors.cv} aria-describedby="intake-cv-help intake-cv-error" onClick={() => fileInput.current?.click()}>Cambiar</Button><Button type="button" variant="ghost" className="min-h-10" onClick={() => { onFile(null); if (fileInput.current) fileInput.current.value = ""; }}>Quitar</Button></ItemActions></Item> : <div className="flex justify-center rounded-2xl border border-dashed p-5"><Button type="button" variant="outline" className="min-h-10" aria-invalid={!!errors.cv} aria-describedby="intake-cv-help intake-cv-error" onClick={() => fileInput.current?.click()}><Upload aria-hidden="true" data-icon="inline-start" />Elegir archivo</Button></div>}
   <FieldDescription id="intake-cv-help">PDF o Word (.docx), máximo 5 MB.</FieldDescription>{errors.cv && <FieldError id="intake-cv-error">{errors.cv}</FieldError>}</Field></Section>
 </FieldGroup>;
}

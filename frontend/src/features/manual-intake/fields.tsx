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
import { SENIORITIES, SENIORITY_LABELS } from "@/features/candidate/model";
import { EducationFields } from "@/features/candidate/education-fields";
import { LanguageListEditor } from "@/features/languages/language-field";
import type { Board } from "@/features/pipeline-movement/model";
import type { Draft, Errors } from "./draft";

const profileKeys = ["professional_title", "current_company", "years_of_experience", "seniority", "summary", "skills", "linkedin_url", "portfolio_url"] as const;
function Required() { return <span aria-hidden="true" className="text-primary"> *</span>; }
function dataCount(count: number) { return `${count} ${count === 1 ? "dato" : "datos"}`; }
function Section({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
 return <FieldSet><FieldLegend className="text-xs uppercase tracking-wide text-muted-foreground"><span className="flex items-center gap-2"><Icon className="size-4" aria-hidden="true" />{title}{title === "Estudios" && <Required />}</span></FieldLegend><FieldGroup>{children}</FieldGroup></FieldSet>;
}
export function Choice({ name, label, value, options, onChange, error }: { name: string; label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; error?: string }) {
 const id = `intake-${name}`;
 return <Field data-invalid={!!error}><FieldLabel htmlFor={id}>{label}{name === "stage_id" && <Required />}</FieldLabel><Select items={options} value={value || null} onValueChange={next => onChange(next ?? "")}><SelectTrigger id={id} className="min-h-10 w-full" aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}><SelectValue placeholder="Elige una opción" /></SelectTrigger><SelectContent><SelectGroup>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent></Select>{error && <FieldError id={`${id}-error`}>{error}</FieldError>}</Field>;
}
/** Reuse profile editors without their Card surface inside this Sheet. */
export function IntakeFields({ draft, onChange, errors, stages, stage, onStage, existing, file, onFile, onContactBlur, contactNotice }: { draft: Draft; onChange: (draft: Draft) => void; errors: Errors; stages: Board["stages"]; stage: string; onStage: (value: string) => void; existing: boolean; file: File | null; onFile: (file: File | null) => void; onContactBlur: () => void; contactNotice?: ReactNode }) {
 const fileInput = useRef<HTMLInputElement>(null);
 const [profileOpen, setProfileOpen] = useState<string[]>([]);
 const profileInvalid = Object.keys(errors).some(key => profileKeys.some(name => key === name) || key.startsWith("languages"));
 const filled = profileKeys.filter(key => draft[key].trim()).length + (draft.languages.some(row => row.code || row.level) ? 1 : 0);
 const issues = Object.entries(errors).map(([path, message]) => ({ path: path.replace(/\[(\d+)\]/g, ".$1"), message }));
 const scalar = (name: Exclude<keyof Draft, "residence" | "languages" | "education">, label: string, type = "text", multiline = false) => {
  const id = `intake-${name}`; const error = errors[name];
  const props = { id, value: draft[name], className: "min-h-10", "aria-invalid": !!error || ((name === "email" || name === "phone") && !!errors.contact), "aria-describedby": [(name === "email" || name === "phone") && errors.contact ? "intake-contact-error" : error ? `${id}-error` : "", name === "years_of_experience" ? `${id}-help` : ""].filter(Boolean).join(" ") || undefined, onChange: (event: { target: { value: string } }) => onChange({ ...draft, [name]: event.target.value }), onBlur: name === "email" || name === "phone" ? onContactBlur : undefined };
  return <Field data-invalid={props["aria-invalid"]}><FieldLabel htmlFor={id}>{label}{["full_name", "email", "phone"].includes(name) && <Required />}</FieldLabel>{multiline ? <Textarea {...props} /> : <Input {...props} type={type} {...(name === "years_of_experience" ? { inputMode: "decimal" as const } : {})} />}{name === "years_of_experience" && <FieldDescription id={`${id}-help`}>Puedes usar decimales, por ejemplo 1.5.</FieldDescription>}{error && <FieldError id={`${id}-error`}>{error}</FieldError>}</Field>;
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
    {/* Duplicate notice lives with the contact data that triggered it. */}
    {contactNotice}
  </Section><Separator /><Section title="Residencia" icon={MapPin}>
    <LocationField requiredIndicator={<Required />} label="Residencia" hideLegend value={draft.residence} onChange={residence => onChange({ ...draft, residence })} depth="municipality" postalCode defaultCountry={null} required={draft.residence.country === "MX" ? ["country", "state", "municipality"] : ["country"]}
      errors={Object.keys(errors).filter(key => key.startsWith("residence.")).map(key => ({ field: key.slice(10), message: errors[key], reason: errors[key] === "Revisa este dato." ? "unknown" as const : errors[key] === "Este dato no se permite aquí." ? "not_allowed" as const : "required" as const }))} />
  </Section><Separator /><Section title="Estudios" icon={GraduationCap}>
    <div data-intake-education aria-invalid={!!errors.education} tabIndex={errors.education ? -1 : undefined} aria-describedby={errors.education ? "intake-education-error" : undefined}>
    {errors.education && <FieldError id="intake-education-error">{errors.education}</FieldError>}
    <EducationFields embedded requiredMarker={<Required />} value={draft.education} issues={issues.filter(issue => issue.path !== "education")} onChange={education => onChange({ ...draft, education })} />
    </div>
  </Section><Separator /><Accordion value={profileInvalid ? ["profile"] : profileOpen} onValueChange={setProfileOpen}><AccordionItem value="profile"><AccordionTrigger>Perfil profesional (opcional){filled > 0 && <Badge variant="secondary">{dataCount(filled)}</Badge>}</AccordionTrigger><AccordionContent><FieldGroup>
    {scalar("professional_title", "Título profesional")}{scalar("current_company", "Empresa actual o última")}{scalar("years_of_experience", "Años de experiencia")}<Choice name="seniority" label="Seniority" value={draft.seniority} error={errors.seniority} onChange={seniority => onChange({ ...draft, seniority })} options={[{ value: "", label: "Sin especificar" }, ...SENIORITIES.map(value => ({ value, label: SENIORITY_LABELS[value] }))]} />{scalar("summary", "Resumen profesional", "text", true)}{scalar("skills", "Habilidades", "text", true)}
    <FieldDescription>Separa las habilidades con comas o saltos de línea. Máximo 30.</FieldDescription>
    <FieldSet><FieldLegend variant="label">Idiomas</FieldLegend><FieldGroup>
    <div data-intake-languages aria-invalid={!!errors.languages} tabIndex={errors.languages ? -1 : undefined}>
    <LanguageListEditor value={draft.languages} issues={issues} onChange={languages => onChange({ ...draft, languages })} />
    </div></FieldGroup></FieldSet>
    {scalar("linkedin_url", "Perfil de LinkedIn", "url")}{scalar("portfolio_url", "Portafolio o sitio web", "url")}
  </FieldGroup></AccordionContent></AccordionItem></Accordion></>}
  <Separator /><Section title="CV" icon={FileText}><Field data-invalid={!!errors.cv}><FieldLabel htmlFor="intake-cv">CV<Required /></FieldLabel><input ref={fileInput} id="intake-cv" type="file" className="sr-only" tabIndex={-1} accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={event => { const selected = event.target.files?.[0]; if (selected) onFile(selected); event.target.value = ""; }} />
   {file ? <Item variant="outline" className="min-w-0 flex-wrap"><ItemMedia variant="icon"><FileText aria-hidden="true" /></ItemMedia><ItemContent className="min-w-0 flex-1 basis-40"><ItemTitle className="w-full min-w-0"><Tooltip><TooltipTrigger render={<span tabIndex={0} className="block truncate" />}>{file.name}</TooltipTrigger><TooltipContent>{file.name}</TooltipContent></Tooltip></ItemTitle><ItemDescription>{formatApplicationCvSize(file.size)}</ItemDescription></ItemContent><ItemActions><Button type="button" variant="outline" className="min-h-10" aria-invalid={!!errors.cv} aria-describedby="intake-cv-help intake-cv-error" onClick={() => fileInput.current?.click()}>Cambiar</Button><Button type="button" variant="ghost" className="min-h-10" onClick={() => { onFile(null); if (fileInput.current) fileInput.current.value = ""; }}>Quitar</Button></ItemActions></Item> : <div className="flex justify-center rounded-2xl border border-dashed p-5"><Button type="button" variant="outline" className="min-h-10" aria-invalid={!!errors.cv} aria-describedby="intake-cv-help intake-cv-error" onClick={() => fileInput.current?.click()}><Upload aria-hidden="true" data-icon="inline-start" />Elegir archivo</Button></div>}
   <FieldDescription id="intake-cv-help">PDF o Word (.docx), máximo 5 MB.</FieldDescription>{errors.cv && <FieldError id="intake-cv-error">{errors.cv}</FieldError>}</Field></Section>
 </FieldGroup>;
}

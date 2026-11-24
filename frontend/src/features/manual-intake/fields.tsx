"use client";
import { useState, type ReactNode } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { ContactRound, FileText, GraduationCap, MapPin, Route, type LucideIcon } from "lucide-react";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DialCodeField } from "@/components/forms/dial-code-field";
import { FileField } from "@/components/ui/file-field";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { LocationField } from "@/features/geo/location-field";
import { SENIORITIES, SENIORITY_LABELS } from "@/features/candidate/model";
import { EducationFields } from "@/features/candidate/education-fields";
import { LanguageListEditor } from "@/features/languages/language-field";
import type { Board } from "@/features/pipeline-movement/model";
import type { Draft, Errors } from "./draft";

const cvAccept = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
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
    <FieldGroup className="grid grid-cols-1 gap-3 sm:grid-cols-[13rem_minmax(0,1fr)]"><DialCodeField id="intake-dial" value={draft.dial} onChange={dial => onChange({ ...draft, dial })} error={errors.dial} />{scalar("phone", "Teléfono", "tel")}</FieldGroup>
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
  <Separator /><Section title="CV" icon={FileText}><FileField label={<>CV<Required /></>} value={file} onChange={onFile} accept={cvAccept} hint="PDF o Word (.docx), máximo 5 MB." error={errors.cv} /></Section>
 </FieldGroup>;
}

"use client";

import { LanguageListEditor } from "@/features/languages/language-field";
import { EducationFields } from "@/features/candidate/education-fields";
import { OptionalLocationField, RemoveLocationButton } from "@/features/geo/optional-location-field";
import { locationReadToValue } from "@/features/geo/model";
import { locationErrorMessages, type LocationIssue } from "@/features/geo/model";

import { DialCodeField } from "@/components/forms/dial-code-field";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SENIORITIES, SENIORITY_LABELS, SALARY_PERIOD_LABELS, SALARY_PERIODS } from "./model";
import type { CandidateProfileDraft, ProfileDraftIssue } from "./profile-draft";

/**
 * Controlled, presentation-only editor for profile fields and structured location.
 * It renders the received `draft` and the received `issues` and emits a complete
 * new draft through `onChange` on every edit: no state, form, submission,
 * validation, fixture, network, storage, router, timer, or randomness lives here.
 * The optional-location helper explains eligibility without making location required.
 * The workspace owns persistence, pending state and confirmed baselines. Groups render as plain fieldsets with a
 * quiet sub-heading: the workspace places them inside its tinted in-place section, never a card inside a card.
 */
export const PROFILE_CATEGORIES = ["personal", "experience", "education", "compensation", "languages"] as const;
export type ProfileCategory = (typeof PROFILE_CATEGORIES)[number];

export type ProfileFormFieldsProps = Readonly<{
  draft: CandidateProfileDraft;
  issues: readonly ProfileDraftIssue[];
  onChange: (next: CandidateProfileDraft) => void;
  category?: ProfileCategory;
  disabled?: boolean;
  /** The lock the workspace places after a private label (`educationDetails` for the study details); null otherwise. */
  privateMark?: (path: string) => React.ReactNode;
}>;

/** Every draft key a scalar control owns; languages render as indexed rows. */
type ScalarPath = Exclude<keyof CandidateProfileDraft, "languages" | "location" | "education">;
/** One selectable option: the exact closed-vocabulary value plus its Spanish label. */
type Option = Readonly<{ value: string; label: string }>;
/** One labelled scalar control: native metadata, rhythm and optional unit adornment. */
type ScalarSpec = Readonly<{
  path: ScalarPath; label: string; span?: string;
  type?: "text" | "tel" | "url" | "number"; min?: number; max?: number; step?: number; maxLength?: number;
  multiline?: boolean; options?: readonly Option[]; unit?: (draft: CandidateProfileDraft) => string;
  hideLabel?: boolean; description?: string;
}>;
type Section = Readonly<{ slug: string; legend: string; category: ProfileCategory; grid: string; fields: readonly ScalarSpec[] }>;

/** The summary limit, shown as a live «n / 2000» counter under the field. */
export const SUMMARY_MAX_LENGTH = 2000;
/** Blank first option of the three closed-vocabulary selects and of a language level. */
const BLANK = "Sin especificar";
const optionsOf = <T extends string>(values: readonly T[], labels: Readonly<Record<T, string>>): readonly Option[] =>
  [{ value: "", label: BLANK }, ...values.map((value) => ({ value, label: labels[value] }))];
/** One Base UI Select item: the blank draft value crosses the primitive boundary as `null`. */
type SelectOption = Readonly<{ value: string | null; label: string }>;
/** Maps closed-vocabulary options to Select items, keeping the clearable blank as a `null` item. */
export const toSelectItems = (options: readonly Option[]): readonly SelectOption[] =>
  options.map((option) => ({ value: option.value === "" ? null : option.value, label: option.label }));
/** Converts the primitive's nullable value back to the draft's stable empty-string boundary. */
export const draftValueFromSelect = (value: string | null): string => value ?? "";

/** The declared currency code, or a neutral phrase while the draft carries none. */
const currencyOf = (draft: CandidateProfileDraft): string => (draft.salaryCurrency.trim() === "" ? "sin moneda" : draft.salaryCurrency.trim().toUpperCase());

const SECTIONS: readonly Section[] = [
  { slug: "contact", legend: "Contacto", category: "personal", grid: "grid grid-cols-1 gap-4 sm:grid-cols-2", fields: [
    { path: "phone", label: "Teléfono", type: "tel", maxLength: 30, span: "sm:col-span-2" },
    { path: "linkedinUrl", label: "Perfil de LinkedIn", type: "url", maxLength: 300 },
    { path: "portfolioUrl", label: "Portafolio o sitio web", type: "url", maxLength: 300, span: "sm:col-span-2" },
  ] },
  { slug: "location", legend: "Ubicación", category: "personal", grid: "grid grid-cols-1 gap-4 sm:grid-cols-2", fields: [
  ] },
  { slug: "professional", legend: "Perfil profesional", category: "experience", grid: "grid grid-cols-1 gap-4 sm:grid-cols-6", fields: [
    { path: "professionalTitle", label: "Título profesional", maxLength: 120, span: "sm:col-span-6" },
    { path: "currentCompany", label: "Empresa actual o última", maxLength: 120, span: "sm:col-span-4" },
    { path: "yearsOfExperience", label: "Años de experiencia", type: "number", min: 0, max: 60, step: 0.1, span: "sm:col-span-2", unit: () => "años" },
    { path: "seniority", label: "Seniority", options: optionsOf(SENIORITIES, SENIORITY_LABELS), span: "sm:col-span-6" },
  ] },
  { slug: "trajectory", legend: "Trayectoria", category: "experience", grid: "grid grid-cols-1 gap-4 sm:grid-cols-1", fields: [
    { path: "summary", label: "Resumen profesional", multiline: true, maxLength: SUMMARY_MAX_LENGTH },
  ] },
  { slug: "education", legend: "Formación académica", category: "education", grid: "grid grid-cols-1 gap-4 sm:grid-cols-5", fields: [

  ] },
  { slug: "skills", legend: "Habilidades", category: "education", grid: "grid grid-cols-1 gap-4 sm:grid-cols-1", fields: [
    { path: "skills", label: "Habilidades", multiline: true, hideLabel: true, description: "Separa cada habilidad con una coma o un salto de línea. Ejemplo: React, SQL, Atención a clientes. Máximo 60 habilidades, de 60 caracteres cada una." },
  ] },
  { slug: "compensation", legend: "Salario actual", category: "compensation", grid: "grid grid-cols-1 gap-4 sm:grid-cols-2", fields: [
    { path: "currentSalaryGross", label: "Salario bruto actual", type: "number", min: 0, max: 100_000_000, step: 1, unit: currencyOf },
    { path: "currentSalaryNet", label: "Salario neto actual", type: "number", min: 0, max: 100_000_000, step: 1, unit: currencyOf },
    { path: "salaryCurrency", label: "Moneda", maxLength: 3, unit: () => "ISO 4217" },
  ] },
  { slug: "expectation", legend: "Expectativas salariales", category: "compensation", grid: "grid grid-cols-1 gap-4 sm:grid-cols-3", fields: [
    { path: "expectedSalary", label: "Salario esperado", type: "number", min: 0, max: 100_000_000, step: 1, span: "sm:col-span-1", unit: currencyOf },
    { path: "expectedSalaryPeriod", label: "Periodo del salario esperado", options: optionsOf(SALARY_PERIODS, SALARY_PERIOD_LABELS), span: "sm:col-span-2" },
  ] },
];

/** Token-only paint: one 40px target baseline, one visible focus ring and calm transitions. */
const TARGET = "min-h-10";
const FRAME = "min-h-10 transition-[color,box-shadow] duration-200 motion-reduce:transition-none";
/** Full-width Select trigger: 40px target, visible focus and the primitive's token-only paint. */
const SELECT_TRIGGER = `${TARGET} w-full motion-reduce:transition-none`;
const SECTION = "min-w-0 gap-3";
const LEGEND = "sr-only";
/** The group's visible sub-heading (artboard 04 `.sub`); the sr-only legend names the fieldset. */
const SUBHEAD_ROW = "flex min-h-10 items-center justify-between gap-3";
const SUBHEAD = "text-[13px] leading-[18px] font-semibold tracking-[0.02em] text-muted-foreground";
const SUMMARY_MAX = SUMMARY_MAX_LENGTH;

function GroupHead({ legend, action }: Readonly<{ legend: string; action?: React.ReactNode }>) {
  return <div className={SUBHEAD_ROW}><p aria-hidden="true" data-pf-profile-subhead="" className={SUBHEAD}>{legend}</p>{action}</div>;
}

/** One labelled control: schema-aligned frame, optional adornment and error-only aria wiring. */
function ScalarField({ spec, draft, error, onChange, describedBy, mark }: Readonly<{ spec: ScalarSpec; draft: CandidateProfileDraft; error: string | null; onChange: (value: string) => void; describedBy?: string; mark?: React.ReactNode }>) {
  const id = `profile-${spec.path}`;
  const invalid = error === null ? undefined : true;
  const value = draft[spec.path];
  const items = spec.options === undefined ? null : toSelectItems(spec.options);
  const handle = (event: { readonly target: { readonly value: string } }): void => onChange(event.target.value);
  const counted = spec.path === "summary";
  const description = [describedBy, spec.description ? `${id}-help` : null, counted ? `${id}-count` : null, error === null ? null : `${id}-error`].filter(Boolean).join(" ") || undefined;
  const aria = { id, "data-pf-profile-field": spec.path, "aria-invalid": invalid, "aria-describedby": description };
  return (
    <Field data-invalid={invalid} className={spec.span}>
      <FieldLabel htmlFor={id} className={spec.hideLabel ? "sr-only" : undefined}>{spec.label}{mark}</FieldLabel>
      {items === null
        ? spec.multiline
          ? <InputGroup className={`${FRAME} max-w-prose`}><InputGroupTextarea {...aria} value={value} className="min-h-24" maxLength={spec.maxLength} onChange={handle} /></InputGroup>
          : <InputGroup className={FRAME}>
            <InputGroupInput {...aria} value={value} className={TARGET} type={spec.type ?? "text"} min={spec.min} max={spec.max} step={spec.step} maxLength={spec.maxLength} onChange={handle} />
            {spec.unit === undefined ? null : <InputGroupAddon align="inline-end"><InputGroupText>{spec.unit(draft)}</InputGroupText></InputGroupAddon>}
          </InputGroup>
        : <Select items={items} value={value === "" ? null : value} onValueChange={(next) => onChange(draftValueFromSelect(next))}>
          <SelectTrigger {...aria} className={SELECT_TRIGGER}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {items.map((item) => (<SelectItem key={item.value ?? "blank"} value={item.value}>{item.label}</SelectItem>))}
            </SelectGroup>
          </SelectContent>
        </Select>}
      {spec.description && <FieldDescription id={`${id}-help`}>{spec.description}</FieldDescription>}
      {counted && <p id={`${id}-count`} data-pf-profile-counter="" className="max-w-prose text-right text-xs text-muted-foreground tabular-nums">{value.length} / {SUMMARY_MAX}<span className="sr-only"> caracteres</span></p>}
      {spec.path === "yearsOfExperience" && <FieldDescription>Puedes usar decimales, por ejemplo 1.5.</FieldDescription>}
      {error === null ? null : <FieldError id={`${id}-error`}>{error}</FieldError>}
    </Field>
  );
}

/** One scalar group: an sr-only legend, a quiet visible sub-heading with its optional action, then the field grid. */
function ScalarSection({ section, draft, errorFor, onChange, location, headerAction, privateMark }: Readonly<{ section: Section; draft: CandidateProfileDraft; errorFor: (path: string) => string | null; onChange: (path: ScalarPath, value: string) => void; location?: React.ReactNode; headerAction?: React.ReactNode; privateMark?: (path: string) => React.ReactNode }>) {
  return (
        <FieldSet data-pf-profile-group={section.slug} className={SECTION}>
          <FieldLegend className={LEGEND}>{section.legend}</FieldLegend>
          <GroupHead legend={section.legend} action={headerAction} />
          <FieldGroup data-pf-profile-fields-grid="" className={section.grid}>
            {section.fields.map((spec) => spec.path === "phone" ? (
              <FieldGroup key={spec.path} className={spec.span}>
                <div data-pf-profile-phone="" className="grid grid-cols-1 gap-3 sm:grid-cols-[13rem_minmax(0,1fr)]">
                  <DialCodeField id="profile-dial" data-pf-profile-field="dial" value={draft.dial} aria-describedby="profile-phone-help" onChange={value => onChange("dial", value)} />
                  <ScalarField spec={{ ...spec, span: undefined }} draft={draft} error={errorFor("phone")} describedBy="profile-phone-help" mark={privateMark?.("phone")} onChange={value => onChange("phone", value)} />
                </div>
                <FieldDescription id="profile-phone-help">México: +52 y 10 dígitos. Otros países: lada y número, de 8 a 15 dígitos en total.</FieldDescription>
              </FieldGroup>
            ) : (
              <ScalarField key={spec.path} spec={spec} draft={draft} error={errorFor(spec.path)} mark={privateMark?.(spec.path)} onChange={(value) => onChange(spec.path, value)} />
            ))}
            {section.slug === "location" && location}
          </FieldGroup>
        </FieldSet>
  );
}

/** The controlled field editor: every rendered value and message comes from props. */
export function ProfileFormFields({ draft, issues, onChange, category, disabled, privateMark }: ProfileFormFieldsProps) {
  const byPath = new Map<string, string>();
  for (const issue of issues) if (!byPath.has(issue.path)) byPath.set(issue.path, issue.message);
  const errorFor = (path: string): string | null => byPath.get(path) ?? null;

  /** Immutable scalar edit: a shallow clone carrying the one changed key. */
  const updateScalar = (path: ScalarPath, value: string): void => { onChange({ ...draft, [path]: value }); };
  const languagesGroup = (
    <FieldSet data-pf-profile-group="languages" className={SECTION}>
      <FieldLegend className={LEGEND}>Idiomas</FieldLegend>
      <GroupHead legend="Idiomas" />
      <LanguageListEditor value={draft.languages} onChange={languages => onChange({ ...draft, languages })} issues={issues} disabled={disabled} />
    </FieldSet>
  );
  const sections = category === undefined ? SECTIONS : SECTIONS.filter((section) => section.category === category);
  const withLanguages = category === undefined || category === "languages";
  const detailsMark = privateMark?.("educationDetails");
  return (
    <FieldGroup data-pf-profile-fields="" className="flex min-w-0 flex-col gap-6">
      {sections.map((section) => section.slug === "education" ? <div key={section.slug} className="flex min-w-0 flex-col gap-3"><GroupHead legend={section.legend} action={detailsMark ? <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">Detalles de cada estudio{detailsMark}</span> : undefined} /><EducationFields embedded value={draft.education} onChange={education => onChange({ ...draft, education })} issues={issues} disabled={disabled} /></div> : (
        <ScalarSection key={section.slug} section={section} draft={draft} errorFor={errorFor} onChange={updateScalar} privateMark={privateMark} headerAction={section.slug === "location" && draft.location.country !== null ? <RemoveLocationButton disabled={disabled} onRemove={() => onChange({ ...draft, location: locationReadToValue(null) })} /> : undefined} location={<div className="sm:col-span-2" data-pf-profile-field="location"><OptionalLocationField inlineRemove={false} value={draft.location} onChange={location => onChange({ ...draft, location })} depth="municipality" postalCode={false} label="Ubicación" hideLegend countryDescription="Opcional. Algunas vacantes solo aceptan postulantes de ciertos países." disabled={disabled} errors={issues.filter(issue => issue.path.startsWith("location.")).map(issue => ({ field: issue.path.slice(9) as LocationIssue["field"], reason: (Object.keys(locationErrorMessages) as LocationIssue["reason"][]).find(reason => locationErrorMessages[reason] === issue.message) ?? "unknown" }))} /></div>} />
      ))}
      {withLanguages ? languagesGroup : null}
    </FieldGroup>
  );
}

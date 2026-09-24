"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { Field, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { CEFR_LEVELS, CEFR_LEVEL_LABELS, EDUCATION_LEVELS, EDUCATION_LEVEL_LABELS, SALARY_PERIOD_LABELS, SALARY_PERIODS } from "./model";
import type { CefrLevel } from "./model";
import type { CandidateLanguageDraft, CandidateProfileDraft, ProfileDraftIssue } from "./profile-draft";

/**
 * Controlled, presentation-only editor for the 19 editable profile draft fields.
 * It renders the received `draft` and the received `issues` and emits a complete
 * new draft through `onChange` on every edit: no state, form, submission,
 * validation, fixture, network, storage, router, timer, or randomness lives here.
 * Only the adjacent validation errors and the necessary accessible labels survive:
 * no helper lines, section intro copy or decorative icons. CDP-07B2 owns the form
 * element, local orchestration and the no-save messaging.
 */
export const PROFILE_CATEGORIES = ["personal", "experience", "education", "compensation", "languages"] as const;
export type ProfileCategory = (typeof PROFILE_CATEGORIES)[number];

export type ProfileFormFieldsProps = Readonly<{
  draft: CandidateProfileDraft;
  issues: readonly ProfileDraftIssue[];
  onChange: (next: CandidateProfileDraft) => void;
  category?: ProfileCategory;
}>;

/** Every draft key a scalar control owns; languages render as indexed rows. */
type ScalarPath = Exclude<keyof CandidateProfileDraft, "languages">;
/** One selectable option: the exact closed-vocabulary value plus its Spanish label. */
type Option = Readonly<{ value: string; label: string }>;
/** One labelled scalar control: native metadata, rhythm and optional unit adornment. */
type ScalarSpec = Readonly<{
  path: ScalarPath; label: string; span?: string;
  type?: "text" | "tel" | "url" | "number"; min?: number; max?: number; step?: number; maxLength?: number;
  multiline?: boolean; options?: readonly Option[]; unit?: (draft: CandidateProfileDraft) => string;
}>;
type Section = Readonly<{ slug: string; legend: string; category: ProfileCategory; grid: string; fields: readonly ScalarSpec[] }>;

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
const CEFR_OPTIONS = optionsOf(CEFR_LEVELS, CEFR_LEVEL_LABELS);
const CEFR_ITEMS = toSelectItems(CEFR_OPTIONS);

/** The declared currency code, or a neutral phrase while the draft carries none. */
const currencyOf = (draft: CandidateProfileDraft): string => (draft.salaryCurrency.trim() === "" ? "sin moneda" : draft.salaryCurrency.trim().toUpperCase());

const SECTIONS: readonly Section[] = [
  { slug: "contact", legend: "Contacto", category: "personal", grid: "grid grid-cols-1 gap-4 sm:grid-cols-2", fields: [
    { path: "phone", label: "Teléfono", type: "tel", maxLength: 30 },
    { path: "linkedinUrl", label: "Perfil de LinkedIn", type: "url", maxLength: 300 },
    { path: "portfolioUrl", label: "Portafolio o sitio web", type: "url", maxLength: 300, span: "sm:col-span-2" },
  ] },
  { slug: "location", legend: "Ubicación", category: "personal", grid: "grid grid-cols-1 gap-4 sm:grid-cols-[1.25fr_1.05fr_0.7fr]", fields: [
    { path: "birthDate", label: "Fecha de nacimiento" },
    { path: "city", label: "Ciudad de residencia", maxLength: 120 },
    { path: "country", label: "País", maxLength: 120 },
  ] },
  { slug: "professional", legend: "Perfil profesional", category: "experience", grid: "grid grid-cols-1 gap-4 sm:grid-cols-6", fields: [
    { path: "professionalTitle", label: "Título profesional", maxLength: 120, span: "sm:col-span-6" },
    { path: "currentCompany", label: "Empresa actual o última", maxLength: 120, span: "sm:col-span-4" },
    { path: "yearsOfExperience", label: "Años de experiencia", type: "number", min: 0, max: 60, step: 1, span: "sm:col-span-2", unit: () => "años" },
  ] },
  { slug: "trajectory", legend: "Trayectoria", category: "experience", grid: "grid grid-cols-1 gap-4 sm:grid-cols-1", fields: [
    { path: "summary", label: "Resumen profesional", multiline: true, maxLength: 2000 },
  ] },
  { slug: "education", legend: "Formación académica", category: "education", grid: "grid grid-cols-1 gap-4 sm:grid-cols-5", fields: [
    { path: "educationLevel", label: "Nivel máximo de estudios", options: optionsOf(EDUCATION_LEVELS, EDUCATION_LEVEL_LABELS), span: "sm:col-span-2" },
    { path: "fieldOfStudy", label: "Campo de estudio", maxLength: 120, span: "sm:col-span-3" },
  ] },
  { slug: "skills", legend: "Habilidades", category: "education", grid: "grid grid-cols-1 gap-4 sm:grid-cols-1", fields: [
    { path: "skills", label: "Habilidades", multiline: true },
  ] },
  { slug: "compensation", legend: "Salario actual", category: "compensation", grid: "grid grid-cols-1 gap-4 sm:grid-cols-3", fields: [
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
const CALM = "transition-colors duration-200 motion-reduce:transition-none";
const CONTROLS = `${TARGET} focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50`;
const FRAME = "min-h-10 transition-[color,box-shadow] duration-200 motion-reduce:transition-none";
/** Full-width Select trigger: 40px target, visible focus and the primitive's token-only paint. */
const SELECT_TRIGGER = `${TARGET} w-full motion-reduce:transition-none`;
const SECTION_CARD = "gap-0 py-0 shadow-none ring-border/70";
const SECTION = "gap-4";
const SECTION_HEADER = "border-b py-(--card-spacing)";
const SECTION_CONTENT = "flex flex-col gap-4 py-(--card-spacing)";
const LEGEND = "sr-only";
const ROW = "rounded-xl border border-border/70 bg-muted/30 p-3";
const ROW_GRID = "grid grid-cols-1 gap-3 sm:grid-cols-2";

/** One labelled control: schema-aligned frame, optional adornment and error-only aria wiring. */
function ScalarField({ spec, draft, error, onChange }: Readonly<{ spec: ScalarSpec; draft: CandidateProfileDraft; error: string | null; onChange: (value: string) => void }>) {
  const id = `profile-${spec.path}`;
  const invalid = error === null ? undefined : true;
  const value = draft[spec.path];
  const items = spec.options === undefined ? null : toSelectItems(spec.options);
  const handle = (event: { readonly target: { readonly value: string } }): void => onChange(event.target.value);
  const aria = { id, "data-pf-profile-field": spec.path, "aria-invalid": invalid, "aria-describedby": error === null ? undefined : `${id}-error` };
  const isBirthDate = spec.path === "birthDate";
  return (
    <Field data-invalid={invalid} className={spec.span}>
      <FieldLabel htmlFor={id}>{spec.label}</FieldLabel>
      {isBirthDate
        ? <DatePickerField id={id} value={value} onChange={onChange} allowPast error={error ?? undefined} data-pf-profile-field="birthDate" className="w-full" />
        : items === null
          ? spec.multiline
            ? <InputGroup className={FRAME}><InputGroupTextarea {...aria} value={value} className="min-h-24" maxLength={spec.maxLength} onChange={handle} /></InputGroup>
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
      {error === null || isBirthDate ? null : <FieldError id={`${id}-error`}>{error}</FieldError>}
    </Field>
  );
}

/** One scalar section: a quiet Card whose native header titles the sr-only fieldset legend. */
function ScalarSection({ section, draft, errorFor, onChange }: Readonly<{ section: Section; draft: CandidateProfileDraft; errorFor: (path: string) => string | null; onChange: (path: ScalarPath, value: string) => void }>) {
  return (
    <Card size="sm" data-pf-profile-section-card="" className={SECTION_CARD}>
      <CardHeader className={SECTION_HEADER}>
        <CardTitle aria-hidden="true">{section.legend}</CardTitle>
      </CardHeader>
      <CardContent className={SECTION_CONTENT}>
        <FieldSet data-pf-profile-group={section.slug} className={SECTION}>
          <FieldLegend className={LEGEND}>{section.legend}</FieldLegend>
          <FieldGroup data-pf-profile-fields-grid="" className={section.grid}>
            {section.fields.map((spec) => (
              <ScalarField key={spec.path} spec={spec} draft={draft} error={errorFor(spec.path)} onChange={(value) => onChange(spec.path, value)} />
            ))}
          </FieldGroup>
        </FieldSet>
      </CardContent>
    </Card>
  );
}

/** The controlled field editor: every rendered value and message comes from props. */
export function ProfileFormFields({ draft, issues, onChange, category }: ProfileFormFieldsProps) {
  const byPath = new Map<string, string>();
  for (const issue of issues) if (!byPath.has(issue.path)) byPath.set(issue.path, issue.message);
  const errorFor = (path: string): string | null => byPath.get(path) ?? null;
  const languagesError = errorFor("languages");
  /** Immutable scalar edit: a shallow clone carrying the one changed key. */
  const updateScalar = (path: ScalarPath, value: string): void => { onChange({ ...draft, [path]: value }); };
  /** Immutable row edit: only the addressed row is cloned, the rest are reused. */
  const updateLanguage = (index: number, patch: Partial<CandidateLanguageDraft>): void => {
    onChange({ ...draft, languages: draft.languages.map((row, position) => (position === index ? { ...row, ...patch } : row)) });
  };
  const addLanguage = (): void => { onChange({ ...draft, languages: [...draft.languages, { name: "", level: "" }] }); };
  const removeLanguage = (index: number): void => { onChange({ ...draft, languages: draft.languages.filter((_, position) => position !== index) }); };
  const languageRow = (row: CandidateLanguageDraft, index: number) => {
    const nameId = `profile-language-${index}-name`;
    const levelId = `profile-language-${index}-level`;
    const nameError = errorFor(`languages.${index}.name`);
    const levelError = errorFor(`languages.${index}.level`);
    return (
      <div key={index} data-pf-profile-language-row={index} role="group" aria-label={`Idioma ${index + 1}`} className={ROW}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Badge variant="secondary">{`Idioma ${index + 1}`}</Badge>
          <Button type="button" variant="ghost" size="sm" data-pf-profile-language-remove className={`${CONTROLS} ${CALM}`} onClick={() => removeLanguage(index)}>
            <Trash2Icon data-icon="inline-start" />{`Quitar idioma ${index + 1}`}
          </Button>
        </div>
        <div data-pf-profile-language-grid="" className={ROW_GRID}>
          <Field data-invalid={nameError === null ? undefined : true}>
            <FieldLabel htmlFor={nameId}>{`Nombre del idioma ${index + 1}`}</FieldLabel>
            <InputGroup className={FRAME}>
              <InputGroupInput id={nameId} data-pf-profile-language-name type="text" maxLength={60} value={row.name} className={TARGET} aria-invalid={nameError === null ? undefined : true} aria-describedby={nameError === null ? undefined : `${nameId}-error`} onChange={(event) => updateLanguage(index, { name: event.target.value })} />
            </InputGroup>
            {nameError === null ? null : <FieldError id={`${nameId}-error`}>{nameError}</FieldError>}
          </Field>
          <Field data-invalid={levelError === null ? undefined : true}>
            <FieldLabel htmlFor={levelId}>{`Nivel del idioma ${index + 1}`}</FieldLabel>
            <Select items={CEFR_ITEMS} value={row.level === "" ? null : row.level} onValueChange={(next) => updateLanguage(index, { level: draftValueFromSelect(next) as "" | CefrLevel })}>
              <SelectTrigger id={levelId} data-pf-profile-language-level className={SELECT_TRIGGER} aria-invalid={levelError === null ? undefined : true} aria-describedby={levelError === null ? undefined : `${levelId}-error`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {CEFR_ITEMS.map((item) => (<SelectItem key={item.value ?? "blank"} value={item.value}>{item.label}</SelectItem>))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {levelError === null ? null : <FieldError id={`${levelId}-error`}>{levelError}</FieldError>}
          </Field>
        </div>
      </div>
    );
  };
  const languagesCard = (
    <Card size="sm" data-pf-profile-section-card="" className={`${SECTION_CARD} md:col-span-2`}>
      <CardHeader className={SECTION_HEADER}>
        <CardTitle aria-hidden="true">{"Idiomas"}</CardTitle>
      </CardHeader>
      <CardContent className={SECTION_CONTENT}>
        <FieldSet data-pf-profile-group="languages" data-pf-profile-field="languages" className={SECTION} aria-describedby={languagesError === null ? undefined : "profile-languages-error"}>
          <FieldLegend className={LEGEND}>{"Idiomas"}</FieldLegend>
          {languagesError === null ? null : <FieldError id="profile-languages-error">{languagesError}</FieldError>}
          <Separator data-pf-profile-divider="" />
          <FieldGroup className="gap-3">{draft.languages.map(languageRow)}</FieldGroup>
          <Button type="button" variant="outline" data-pf-profile-language-add className={`${CONTROLS} ${CALM} w-fit`} onClick={addLanguage}>
            <PlusIcon data-icon="inline-start" />Agregar idioma
          </Button>
        </FieldSet>
      </CardContent>
    </Card>
  );
  const sections = category === undefined ? SECTIONS : SECTIONS.filter((section) => section.category === category);
  const withLanguages = category === undefined || category === "languages";
  return (
    <FieldGroup data-pf-profile-fields="" className="grid grid-cols-1 gap-5 md:grid-cols-2">
      {sections.map((section) => (
        <ScalarSection key={section.slug} section={section} draft={draft} errorFor={errorFor} onChange={updateScalar} />
      ))}
      {withLanguages ? languagesCard : null}
    </FieldGroup>
  );
}

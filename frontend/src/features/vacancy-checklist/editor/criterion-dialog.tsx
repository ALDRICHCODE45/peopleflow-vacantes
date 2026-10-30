"use client";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { CEFR_LEVELS, EDUCATION_LEVEL_LABELS, SENIORITY_LABELS } from "@/features/candidate/model";
import { useLanguageCatalog } from "@/features/languages/use-language-catalog";
import { LocationField } from "@/features/geo/location-field";
import { useGeoCatalog } from "@/features/geo/use-geo-catalog";
import type { ScreeningQuestionV2 } from "@/features/jobs/drafts/screening-v2/model";
import type { Criterion } from "../model";
import { ChoiceField } from "./controls";
import { MultiChoiceField } from "./multi-choice-field";

export const KIND_LABELS: Record<Criterion["kind"], string> = { min_years_experience: "Años de experiencia", seniority: "Seniority", education: "Estudios", language: "Idioma", skill: "Habilidad", location: "Ubicación", screening_answer: "Respuesta de filtro", manual: "Manual" };
export const defaults: Record<Criterion["kind"], Record<string, unknown>> = { min_years_experience: { min: "1" }, seniority: { accepted: [] }, education: { min_level: "bachelor", accepts_in_progress: false }, language: { code: "", min_level: "B2" }, skill: { name: "" }, location: { country: "", states: [] }, screening_answer: { question_id: "", accepted_option_ids: [] }, manual: {} };
const entries = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));
export function automaticLabel(criterion: Criterion, questions: ScreeningQuestionV2[], languages: { code: string; name: string }[], states: { id: string; name: string }[], countries: { id: string; name: string }[]) {
  switch (criterion.kind) {
    case "min_years_experience": return `Al menos ${criterion.params.min} años de experiencia`;
    case "seniority": return `Nivel ${criterion.params.accepted.map(level => SENIORITY_LABELS[level]).join(", ")}`;
    case "education": return `Escolaridad mínima: ${EDUCATION_LEVEL_LABELS[criterion.params.min_level]}${criterion.params.accepts_in_progress ? " (acepta en curso)" : ""}`;
    case "language": return `Idioma: ${languages.find(item => item.code === criterion.params.code)?.name ?? criterion.params.code} · mínimo ${criterion.params.min_level}`;
    case "skill": return `Habilidad: ${criterion.params.name}`;
    case "location": return `Ubicación: ${countries.find(item => item.id === criterion.params.country)?.name ?? "Elige un país"}${criterion.params.states.length ? ` · ${states.filter(item => criterion.params.states.includes(item.id)).map(item => item.name).join(", ")}` : ""}`;
    case "screening_answer": return questions.find(item => item.id.toLowerCase() === criterion.params.question_id.toLowerCase())?.prompt.slice(0, 200) ?? "Respuesta de filtro";
    case "manual": return "";
  }
}
function LanguageControls({ value, onChange, errors }: { value: Extract<Criterion, { kind: "language" }>["params"]; onChange: (params: Record<string, unknown>, label?: string) => void; errors: Record<string, string> }) {
  const catalog = useLanguageCatalog();
  return <>
    {catalog.status === "loading" || catalog.status === "idle" ? <Skeleton aria-label="Cargando idiomas" className="h-10 w-full" /> : <ChoiceField label="Idioma" options={(catalog.data?.items ?? []).map(item => ({ value: item.code, label: item.name }))} value={value.code} onChange={code => onChange({ code }, `Idioma: ${catalog.data?.items.find(item => item.code === code)?.name ?? code} · mínimo ${value.min_level}`)} error={errors.code} />}
    {catalog.status === "error" && <Field><FieldError>No pudimos cargar los idiomas.</FieldError><Button variant="outline" onClick={catalog.retry}>Reintentar idiomas</Button></Field>}
    <ChoiceField label="Nivel mínimo" options={CEFR_LEVELS.map(value => ({ value, label: value === "native" ? "Nativo" : value }))} value={value.min_level} onChange={min_level => onChange({ min_level }, `Idioma: ${catalog.data?.items.find(item => item.code === value.code)?.name ?? value.code} · mínimo ${min_level}`)} error={errors.min_level} />
  </>;
}
function LocationControls({ value, onChange, errors }: { value: Extract<Criterion, { kind: "location" }>["params"]; onChange: (params: Record<string, unknown>, label?: string) => void; errors: Record<string, string> }) {
  const catalog = useGeoCatalog(null, value.country === "MX");
  return <>
    <LocationField hideLegend label="País del criterio" value={{ country: value.country || null, state: null, municipality: null, postal_code: null }} onChange={location => onChange({ country: location.country ?? "", states: [] }, `Ubicación: ${catalog.countries.data?.items.find(item => item.id === location.country)?.name ?? "Elige un país"}`)} depth="country" postalCode={false} defaultCountry={null} errors={errors.country ? [{ field: "country", reason: "required", message: errors.country }] : []} />
    {value.country === "MX" && (catalog.states.status === "loading" || catalog.states.status === "idle" ? <Skeleton aria-label="Cargando estados" className="h-10 w-full" /> : <MultiChoiceField label="Estados" options={(catalog.states.data?.items ?? []).map(item => ({ value: item.id, label: item.name }))} value={value.states} onChange={states => onChange({ states }, `Ubicación: ${catalog.countries.data?.items.find(item => item.id === value.country)?.name ?? "Elige un país"}${states.length ? ` · ${catalog.states.data?.items.filter(item => states.includes(item.id)).map(item => item.name).join(", ")}` : ""}`)} error={errors.states} />)}
    {catalog.states.status === "error" && <Field><FieldError>No pudimos cargar los estados.</FieldError><Button variant="outline" onClick={catalog.states.retry}>Reintentar estados</Button></Field>}
  </>;
}
/** Catalog-backed criterion fields rendered inline in the checklist detail panel. */
export function CriterionFields({ draft, questions, errors = {}, onChange }: { draft: Criterion; questions: ScreeningQuestionV2[]; errors?: Record<string, string>; onChange: (criterion: Criterion) => void }) {
  const selectable = questions.filter(question => question.type !== "open");
  const catalog = useLanguageCatalog();
  const languages = catalog.data?.items ?? [];
  const geo = useGeoCatalog(null, draft.kind === "location" && draft.params.country === "MX");
  const states = geo.states.data?.items ?? [];
  const countries = geo.countries.data?.items ?? [];
  const generated = automaticLabel(draft, questions, languages, states, countries);
  const automatic = !draft.label || draft.label === generated || draft.label === automaticLabel(draft, questions, [], [], []);
  function update(params: Record<string, unknown>, label?: string) {
    const next = { ...draft, params: { ...draft.params, ...params } } as Criterion;
    onChange({ ...next, label: automatic ? label ?? automaticLabel(next, questions, languages, states, countries) : draft.label });
  }
  return <FieldGroup>
          <ChoiceField label="Tipo de criterio" options={entries(KIND_LABELS)} value={draft.kind} onChange={kind => { const next = { ...draft, kind, params: defaults[kind as Criterion["kind"]] } as Criterion; onChange({ ...next, label: automatic ? automaticLabel(next, questions, languages, states, countries) : draft.label }); }} />
          {draft.kind === "min_years_experience" && <Field data-invalid={!!errors.min}><FieldLabel htmlFor="criterion-years">Años mínimos</FieldLabel><Input id="criterion-years" type="number" min="0" step="0.1" className="min-h-10" value={draft.params.min} onChange={event => update({ min: event.target.value })} aria-invalid={!!errors.min} />{errors.min && <FieldError>{errors.min}</FieldError>}</Field>}
          {draft.kind === "seniority" && <MultiChoiceField label="Niveles aceptados" options={entries(SENIORITY_LABELS)} value={draft.params.accepted} onChange={accepted => update({ accepted })} error={errors.accepted} />}
          {draft.kind === "education" && <><ChoiceField label="Escolaridad mínima" options={entries(EDUCATION_LEVEL_LABELS)} value={draft.params.min_level} onChange={min_level => update({ min_level })} error={errors.min_level} /><Field orientation="horizontal"><Checkbox id="criterion-progress" checked={draft.params.accepts_in_progress} onCheckedChange={accepts_in_progress => update({ accepts_in_progress })} /><FieldLabel htmlFor="criterion-progress" className="min-h-10">Acepta en curso</FieldLabel></Field></>}
          {draft.kind === "language" && <LanguageControls value={draft.params} onChange={update} errors={errors} />}
          {draft.kind === "skill" && <Field data-invalid={!!errors.name}><FieldLabel htmlFor="criterion-skill">Habilidad</FieldLabel><Input id="criterion-skill" className="min-h-10" value={draft.params.name} onChange={event => update({ name: event.target.value })} aria-invalid={!!errors.name} />{errors.name && <FieldError>{errors.name}</FieldError>}</Field>}
          {draft.kind === "location" && <LocationControls value={draft.params} onChange={update} errors={errors} />}
          {draft.kind === "screening_answer" && <><ChoiceField label="Pregunta" options={selectable.map(question => ({ value: question.id, label: question.prompt }))} value={draft.params.question_id} onChange={question_id => update({ question_id, accepted_option_ids: [] })} error={errors.question_id} /><MultiChoiceField label="Respuestas aceptadas" options={(selectable.find(question => question.id.toLowerCase() === (draft.params as { question_id: string }).question_id.toLowerCase())?.options ?? []).map(option => ({ value: option.id, label: option.label }))} value={draft.params.accepted_option_ids} onChange={accepted_option_ids => update({ accepted_option_ids })} error={errors.accepted_option_ids} /></>}
          <Field data-invalid={!!errors.label}><FieldLabel htmlFor="criterion-label">Etiqueta</FieldLabel><Input id="criterion-label" className="min-h-10" value={draft.label} onChange={event => onChange({ ...draft, label: event.target.value })} aria-invalid={!!errors.label} />{errors.label && <FieldError>{errors.label}</FieldError>}</Field>
        </FieldGroup>;
}

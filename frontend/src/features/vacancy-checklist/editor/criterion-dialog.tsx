"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ActionBar } from "@/components/feedback/action-status";
import { CEFR_LEVELS, EDUCATION_LEVEL_LABELS, SENIORITY_LABELS } from "@/features/candidate/model";
import { useLanguageCatalog } from "@/features/languages/use-language-catalog";
import { LocationField } from "@/features/geo/location-field";
import { useGeoCatalog } from "@/features/geo/use-geo-catalog";
import type { ScreeningQuestionV2 } from "@/features/jobs/drafts/screening-v2/model";
import { criterionSchema, type Criterion } from "../model";
import { ChoiceField } from "./controls";
import { MultiChoiceField } from "./multi-choice-field";

export const KIND_LABELS: Record<Criterion["kind"], string> = { min_years_experience: "Años de experiencia", seniority: "Seniority", education: "Estudios", language: "Idioma", skill: "Habilidad", location: "Ubicación", screening_answer: "Respuesta de filtro", manual: "Manual" };
const defaults: Record<Criterion["kind"], Record<string, unknown>> = { min_years_experience: { min: "1" }, seniority: { accepted: [] }, education: { min_level: "bachelor", accepts_in_progress: false }, language: { code: "", min_level: "B2" }, skill: { name: "" }, location: { country: "", states: [] }, screening_answer: { question_id: "", accepted_option_ids: [] }, manual: {} };
const entries = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));
function automaticLabel(criterion: Criterion, questions: ScreeningQuestionV2[], languages: { code: string; name: string }[], states: { id: string; name: string }[], countries: { id: string; name: string }[]) {
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
/** Controlled dialog-demo: opened by an add button or a row, so there is no DialogTrigger.
 * Header/footer stay fixed with one scrolling body (UI rules §13.8 and §23). */
export function CriterionDialog({ initial, questions, onApply, onClose }: { initial?: Criterion; questions: ScreeningQuestionV2[]; onApply: (criterion: Criterion) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<Criterion>(() => initial ?? { id: crypto.randomUUID(), kind: "manual", params: {}, label: "", importance: "required" });
  const [customLabel, setCustomLabel] = useState(!!initial);
  const [catalogLabel, setCatalogLabel] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const body = useRef<HTMLDivElement>(null);
  const selectable = questions.filter(question => question.type !== "open");
  const update = (params: Record<string, unknown>, label?: string) => {
    setDraft(previous => ({ ...previous, params: { ...previous.params, ...params } }) as Criterion);
    if (label !== undefined) setCatalogLabel(label);
  };
  const label = customLabel ? draft.label : catalogLabel ?? automaticLabel(draft, questions, [], [], []);
  function apply() {
    const parsed = criterionSchema.safeParse({ ...draft, label });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map(issue => [String(issue.path.at(-1)), "Revisa este dato"])));
      requestAnimationFrame(() => body.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    onApply(parsed.data);
  }
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="flex max-h-[min(44rem,calc(100dvh-2rem))] flex-col sm:max-w-xl">
      <DialogHeader><DialogTitle>{initial ? "Editar criterio" : "Agregar criterio"}</DialogTitle><DialogDescription>Define qué necesitas contrastar. Solo lo ve tu equipo.</DialogDescription></DialogHeader>
      <div ref={body} className="min-h-0 flex-1 overflow-y-auto px-1">
        <FieldGroup>
          <ChoiceField label="Tipo de criterio" options={entries(KIND_LABELS)} value={draft.kind} onChange={kind => { setDraft({ ...draft, kind, params: defaults[kind as Criterion["kind"]] } as Criterion); setErrors({}); setCatalogLabel(null); }} />
          {draft.kind === "min_years_experience" && <Field data-invalid={!!errors.min}><FieldLabel htmlFor="criterion-years">Años mínimos</FieldLabel><Input id="criterion-years" type="number" min="0" step="0.1" className="min-h-10" value={draft.params.min} onChange={event => update({ min: event.target.value })} aria-invalid={!!errors.min} />{errors.min && <FieldError>{errors.min}</FieldError>}</Field>}
          {draft.kind === "seniority" && <MultiChoiceField label="Niveles aceptados" options={entries(SENIORITY_LABELS)} value={draft.params.accepted} onChange={accepted => update({ accepted })} error={errors.accepted} />}
          {draft.kind === "education" && <><ChoiceField label="Escolaridad mínima" options={entries(EDUCATION_LEVEL_LABELS)} value={draft.params.min_level} onChange={min_level => update({ min_level })} error={errors.min_level} /><Field orientation="horizontal"><Checkbox id="criterion-progress" checked={draft.params.accepts_in_progress} onCheckedChange={accepts_in_progress => update({ accepts_in_progress })} /><FieldLabel htmlFor="criterion-progress" className="min-h-10">Acepta en curso</FieldLabel></Field></>}
          {draft.kind === "language" && <LanguageControls value={draft.params} onChange={update} errors={errors} />}
          {draft.kind === "skill" && <Field data-invalid={!!errors.name}><FieldLabel htmlFor="criterion-skill">Habilidad</FieldLabel><Input id="criterion-skill" className="min-h-10" value={draft.params.name} onChange={event => update({ name: event.target.value })} aria-invalid={!!errors.name} />{errors.name && <FieldError>{errors.name}</FieldError>}</Field>}
          {draft.kind === "location" && <LocationControls value={draft.params} onChange={update} errors={errors} />}
          {draft.kind === "screening_answer" && <><ChoiceField label="Pregunta" options={selectable.map(question => ({ value: question.id, label: question.prompt }))} value={draft.params.question_id} onChange={question_id => update({ question_id, accepted_option_ids: [] })} error={errors.question_id} /><MultiChoiceField label="Respuestas aceptadas" options={(selectable.find(question => question.id.toLowerCase() === (draft.params as { question_id: string }).question_id.toLowerCase())?.options ?? []).map(option => ({ value: option.id, label: option.label }))} value={draft.params.accepted_option_ids} onChange={accepted_option_ids => update({ accepted_option_ids })} error={errors.accepted_option_ids} /></>}
          <Field data-invalid={!!errors.label}><FieldLabel htmlFor="criterion-label">Etiqueta</FieldLabel><Input id="criterion-label" className="min-h-10" value={label} onChange={event => { setCustomLabel(true); setDraft({ ...draft, label: event.target.value }); }} aria-invalid={!!errors.label} />{errors.label && <FieldError>{errors.label}</FieldError>}</Field>
        </FieldGroup>
      </div>
      <DialogFooter><ActionBar status={null}><DialogClose render={<Button type="button" variant="outline" className="min-h-10" />}>Cancelar</DialogClose><Button type="button" className="min-h-10" onClick={apply}>Aplicar criterio</Button></ActionBar></DialogFooter>
    </DialogContent>
  </Dialog>;
}

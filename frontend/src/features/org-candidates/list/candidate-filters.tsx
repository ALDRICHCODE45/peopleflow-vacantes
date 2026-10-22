"use client";
import { useEffect, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Combobox, ComboboxChip, ComboboxChips, ComboboxChipsInput, ComboboxContent, ComboboxEmpty, ComboboxItem, ComboboxList, ComboboxValue } from "@/components/ui/combobox";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { CEFR_LEVELS, EDUCATION_LEVELS, SENIORITIES, SENIORITY_LABELS } from "@/features/candidate/model";
import { educationLabels } from "@/features/pipeline-movement/profile-filter-dimensions";
import { useGeoResource } from "@/features/geo/use-geo-catalog";
import { statesSchema, municipalitiesSchema } from "@/features/geo/model";
import { listDraftsAction } from "@/features/jobs/drafts/list/actions";
import type { LanguageCatalog } from "@/features/languages/model";
import { repeatableKeys, type CandidateFilters } from "../url-state";
type Option = { value: string; label: string };
const none = { value: "none", label: "Sin dato" };
const yearsOptions = [{ value: "0_1", label: "Menos de 1 año" }, { value: "1_3", label: "1 a 3 años" }, { value: "3_5", label: "3 a 5 años" }, { value: "5_plus", label: "5 años o más" }, none];
const origins = [{ value: "manual", label: "Manual" }, { value: "organic", label: "Orgánico" }];
const labels: Record<string, string> = { q: "Búsqueda", origin: "Origen", vacancy: "Vacante", state: "Estado", municipality: "Municipio", seniority: "Seniority", years: "Años de experiencia", language: "Idiomas", language_min_level: "Nivel mínimo", education_level: "Nivel de estudios", education_in_progress: "Incluye estudios en curso" };
function MultiFilter({ id, label, options, selected, onChange }: { id: string; label: string; options: Option[]; selected: string[]; onChange: (values: string[]) => void }) {
  // Same primitive-id Combobox pattern as the board's PipelineFilterBar. Options
  // come from catalogs, never from the loaded page (there are no v1 facets).
  const complete = [...options, ...selected.filter(value => !options.some(option => option.value === value)).map(value => ({ value, label: value }))];
  const name = (value: string) => complete.find(option => option.value === value)?.label ?? value;
  return <Field><FieldLabel htmlFor={id}>{label}</FieldLabel><Combobox multiple items={complete.map(option => option.value)} value={selected} onValueChange={onChange} itemToStringLabel={name}>
    <ComboboxChips><ComboboxValue>{(values: string[]) => <>{values.map(value => <ComboboxChip key={value}>{name(value)}</ComboboxChip>)}<ComboboxChipsInput id={id} aria-label={label} placeholder="Buscar opciones…" /></>}</ComboboxValue></ComboboxChips>
    <ComboboxContent><ComboboxEmpty>Sin resultados</ComboboxEmpty><ComboboxList>{(value: string) => <ComboboxItem key={value} value={value}>{name(value)}</ComboboxItem>}</ComboboxList></ComboboxContent>
  </Combobox></Field>;
}
function SingleFilter({ id, label, options, value, onChange }: { id: string; label: string; options: Option[]; value?: string; onChange: (value?: string) => void }) {
  const choices = [{ value: "any", label: "Todas las opciones" }, ...options];
  return <Field><FieldLabel htmlFor={id}>{label}</FieldLabel><Select items={choices} value={value ?? "any"} onValueChange={next => onChange(next && next !== "any" ? next : undefined)}><SelectTrigger id={id} className="min-h-10 w-full"><SelectValue>{choices.find(option => option.value === value)?.label ?? "Todas las opciones"}</SelectValue></SelectTrigger><SelectContent><SelectGroup>{choices.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>;
}
function MunicipalityFilter({ state, name, selected, onChange }: { state: string; name: string; selected: string[]; onChange: (values: string[]) => void }) {
  const resource = useGeoResource(`countries/mx/states/${state}/municipalities`, municipalitiesSchema);
  const local = selected.filter(value => value.startsWith(state));
  return <><MultiFilter id={`org-municipality-${state}`} label={`Municipio · ${name}`} options={(resource.data?.items ?? []).map(item => ({ value: item.id, label: item.name }))} selected={local} onChange={next => onChange([...selected.filter(value => !value.startsWith(state)), ...next])} />{resource.status === "error" && <Button type="button" variant="link" onClick={resource.retry}>Reintentar municipios de {name}</Button>}</>;
}
export function CandidateFiltersBar({ filters, onChange, onClear, languages }: { filters: CandidateFilters; onChange: (patch: CandidateFilters) => void; onClear: () => void; languages: LanguageCatalog["items"] }) {
  const [open, setOpen] = useState(false);
  const [vacancies, setVacancies] = useState<Option[]>([]);
  const [vacancyStatus, setVacancyStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [attempt, setAttempt] = useState(0);
  const states = useGeoResource("countries/mx/states", statesSchema);
  useEffect(() => {
    let current = true;
    setVacancyStatus("loading");
    async function load() {
      const options: Option[] = []; const cursors = new Set<string>(); let cursor: string | undefined;
      try {
        do {
          const result = await listDraftsAction({ limit: 50, ...(cursor ? { cursor } : {}) });
          if (!current) return;
          if (!result?.ok) { setVacancyStatus("error"); return; }
          options.push(...result.items.map(item => ({ value: item.id, label: item.title ?? "Vacante sin título" })));
          cursor = result.nextCursor ?? undefined;
          if (cursor && cursors.has(cursor)) { setVacancyStatus("error"); return; }
          if (cursor) cursors.add(cursor);
        } while (cursor);
        setVacancies(options); setVacancyStatus("success");
      } catch { if (current) setVacancyStatus("error"); }
    }
    void load(); return () => { current = false; };
  }, [attempt]);
  const options: Record<string, Option[]> = {
    origin: origins, vacancy: vacancies, state: [...(states.data?.items ?? []).map(item => ({ value: item.id, label: item.name })), none],
    seniority: [...SENIORITIES.map(value => ({ value, label: SENIORITY_LABELS[value] })), none], years: yearsOptions,
    language: [...languages.map(item => ({ value: item.code, label: item.name })), none],
    education_level: [...EDUCATION_LEVELS.map(value => ({ value, label: educationLabels[value] })), none],
    language_min_level: CEFR_LEVELS.map(value => ({ value, label: value === "native" ? "Nativo" : value })),
  };
  const chips = Object.entries(filters).flatMap(([key, raw]) => (Array.isArray(raw) ? raw : raw ? [raw] : []).map(value => ({ key, value, label: `${labels[key] ?? key}: ${key === "education_in_progress" ? "Sí" : options[key]?.find(option => option.value === value)?.label ?? (value === "none" ? "Sin dato" : value)}` })));
  return <section aria-label="Filtros de candidatos" className="flex min-w-0 flex-wrap items-center gap-2"><Sheet open={open} onOpenChange={setOpen}>
    <SheetTrigger render={<Button type="button" variant="outline" className="min-h-10" />}><SlidersHorizontal aria-hidden="true" />Filtros{chips.length > 0 && <Badge variant="secondary">{chips.length}</Badge>}</SheetTrigger>
    <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md"><SheetHeader className="border-b"><SheetTitle>Filtrar candidatos</SheetTitle><SheetDescription>Combina filtros para encontrar perfiles de tu organización. Las opciones de un mismo filtro se suman; entre filtros se cumplen todas las condiciones.</SheetDescription></SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-6"><FieldGroup className="gap-6">
        <SingleFilter id="org-origin" label="Origen" options={origins} value={filters.origin} onChange={origin => onChange({ origin })} />
        {(["vacancy", "state"] as const).map(key => <MultiFilter key={key} id={`org-${key}`} label={labels[key]} options={options[key]} selected={filters[key] ?? []} onChange={values => onChange({ [key]: values })} />)}
        {vacancyStatus === "loading" && <p role="status" className="text-xs text-muted-foreground">Cargando vacantes…</p>}
        {vacancyStatus === "error" && <Button type="button" variant="link" className="min-h-10" onClick={() => setAttempt(value => value + 1)}>Reintentar vacantes</Button>}
        {states.status === "error" && <Button type="button" variant="link" className="min-h-10" onClick={states.retry}>Reintentar estados</Button>}
        {(filters.state ?? []).filter(value => value !== "none").map(state => <MunicipalityFilter key={state} state={state} name={states.data?.items.find(item => item.id === state)?.name ?? state} selected={filters.municipality ?? []} onChange={municipality => onChange({ municipality })} />)}
        {!filters.state?.some(value => value !== "none") && <p className="text-xs text-muted-foreground">Elige un estado para buscar municipios.</p>}
        <Field orientation="horizontal"><Checkbox id="org-municipality-none" checked={filters.municipality?.includes("none") ?? false} onCheckedChange={checked => onChange({ municipality: checked ? [...(filters.municipality ?? []), "none"] : filters.municipality?.filter(value => value !== "none") })} /><FieldLabel htmlFor="org-municipality-none">Sin dato de municipio</FieldLabel></Field>
        {(["seniority", "years", "language"] as const).map(key => <MultiFilter key={key} id={`org-${key}`} label={labels[key]} options={options[key]} selected={filters[key] ?? []} onChange={values => onChange({ [key]: values })} />)}
        {!!filters.language?.length && <SingleFilter id="org-language-min" label="Nivel mínimo" options={options.language_min_level} value={filters.language_min_level} onChange={language_min_level => onChange({ language_min_level })} />}
        <SingleFilter id="org-education" label="Nivel de estudios" options={options.education_level} value={filters.education_level} onChange={education_level => onChange({ education_level })} />
        <p className="text-xs text-muted-foreground">Coincide con este nivel o uno superior.</p>
        {!!filters.education_level && <Field orientation="horizontal"><Checkbox id="org-education-progress" checked={filters.education_in_progress === "true"} onCheckedChange={checked => onChange({ education_in_progress: checked ? "true" : undefined })} /><FieldLabel htmlFor="org-education-progress">Incluye estudios en curso</FieldLabel></Field>}
      </FieldGroup></div><SheetFooter className="border-t"><Button type="button" variant="outline" className="min-h-10" onClick={onClear}>Limpiar</Button><Button type="button" className="min-h-10" onClick={() => setOpen(false)}>Ver candidatos</Button></SheetFooter>
    </SheetContent></Sheet>
    {chips.map(chip => <Button key={`${chip.key}:${chip.value}`} type="button" variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal" aria-label={`Quitar filtro ${chip.label}`} onClick={() => onChange(repeatableKeys.includes(chip.key as typeof repeatableKeys[number]) ? { [chip.key]: (filters[chip.key as typeof repeatableKeys[number]] ?? []).filter(value => value !== chip.value) } : { [chip.key]: undefined })}>{chip.label}<X aria-hidden="true" data-icon="inline-end" /></Button>)}
    {!!chips.length && <Button type="button" variant="ghost" className="min-h-10" onClick={onClear}>Limpiar</Button>}
  </section>;
}

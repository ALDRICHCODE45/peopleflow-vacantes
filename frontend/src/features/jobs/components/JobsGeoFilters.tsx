"use client";

import * as React from "react";
import { MapPinIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger } from "@/components/ui/combobox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useGeoCatalog, useGeoResource } from "../../geo/use-geo-catalog";
import { municipalitiesSchema, type Catalog, type GeoReference } from "../../geo/model";
import { selectedValues, type JobsFilterPatch, type JobsQuery } from "../url";
import { CONTRACT_TYPE_OPTIONS, PROFESSIONAL_AREA_OPTIONS, WORK_MODE_OPTIONS, WORK_SCHEDULE_OPTIONS } from "../drafts/ui/draft-labels";
import { ignoreEscapeClear } from "@/features/geo/escape-clear";

type Resource = { status: string; data?: Catalog; retry: () => void };
const MODES = WORK_MODE_OPTIONS.map(item => ({ id: item.value, name: item.label }));

/** Each mounted state subscribes to the shared cache, avoiding variable hook counts.
 * Municipality-only shared links load their parent catalog for labels, not selection. */
function MunicipalityCatalog({ state, onData }: { state: string; onData: (state: string, data: Catalog) => void }) {
  const resource = useGeoResource(`countries/mx/states/${state}/municipalities`, municipalitiesSchema);
  React.useEffect(() => { if (resource.data) onData(state, resource.data); }, [state, resource.data, onData]);
  return null;
}
function MunicipalityFeedback({ state, name }: { state: string; name: string }) {
  const resource = useGeoResource(`countries/mx/states/${state}/municipalities`, municipalitiesSchema);
  return <CatalogFeedback resource={resource} label={`municipios de ${name}`} />;
}
function CatalogFeedback({ resource, label }: { resource: Resource; label: string }) {
  if (resource.status === "error") return <><FieldError>No pudimos cargar {label}.</FieldError><Button type="button" variant="outline" className="min-h-10" onClick={resource.retry}>Reintentar {label}</Button></>;
  if (resource.status === "idle" || resource.status === "loading") return <div role="status" aria-label={`Cargando ${label}`}><Skeleton aria-hidden="true" className="h-10 w-full" /></div>;
  return null;
}
export function useJobsGeo(query: JobsQuery, draft: JobsQuery) {
  const { states, countries } = useGeoCatalog(null);
  const [municipalities, setMunicipalities] = React.useState<Record<string, Catalog>>({});
  const onData = React.useCallback((state: string, data: Catalog) => setMunicipalities(old => old[state] === data ? old : { ...old, [state]: data }), []);
  const needed = [...new Set([...selectedValues(query.state), ...selectedValues(draft.state), ...selectedValues(query.municipality).map(code => code.slice(0, 2))])];
  const loaders = needed.map(state => <MunicipalityCatalog key={state} state={state} onData={onData} />);
  return { states, countries, municipalities, loaders };
}
export type JobsGeo = ReturnType<typeof useJobsGeo>;
export function statePatch(query: JobsQuery, states: readonly string[]): JobsFilterPatch {
  const removed = selectedValues(query.state).filter(code => !states.includes(code));
  return { state: states, municipality: selectedValues(query.municipality).filter(code => !removed.includes(code.slice(0, 2))) };
}

/** Official popup Combobox composition: one compact trigger per dimension.
 * Selection indicators and keyboard multiselect are owned by ComboboxItem. */
function MultiFilter({ id, label, options, value, onChange, disabled = false, helper }: { id: string; label: string; options: GeoReference[]; value: readonly string[]; onChange: (values: string[]) => void; disabled?: boolean; helper?: string }) {
  const selected = options.filter(item => value.includes(item.id));
  return <Field data-disabled={disabled}>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Combobox multiple items={options} value={selected} onValueChange={ignoreEscapeClear((items: GeoReference[]) => onChange(items.map(item => item.id)))} itemToStringLabel={item => item.name} itemToStringValue={item => item.id} isItemEqualToValue={(a, b) => a.id === b.id} disabled={disabled}>
      <ComboboxTrigger id={id} aria-label={label} aria-describedby={helper ? `${id}-help` : undefined} render={<Button type="button" variant="outline" className="min-h-10 w-full justify-between" />}>
        <span className="min-w-0 truncate">{selected.length ? selected.map(item => item.name).join(", ") : "Todas las opciones"}</span>
      </ComboboxTrigger>
      <ComboboxContent><ComboboxInput aria-label={`Buscar ${label.toLowerCase()}`} showTrigger={false} /><ComboboxEmpty>Sin coincidencias.</ComboboxEmpty><ComboboxList>{(item: GeoReference) => <ComboboxItem key={item.id} value={item}>{item.name}</ComboboxItem>}</ComboboxList></ComboboxContent>
    </Combobox>
    {helper && <FieldDescription id={`${id}-help`}>{helper}</FieldDescription>}
  </Field>;
}
export function JobsGeoFields({ idPrefix, query, onChange, geo }: { idPrefix: string; query: JobsQuery; onChange: (patch: JobsFilterPatch) => void; geo: JobsGeo }) {
  const states = selectedValues(query.state);
  const municipalities = states.flatMap(state => geo.municipalities[state]?.items ?? []);
  const countries = geo.countries.data?.items ?? [];
  return <>
    <MultiFilter id={`${idPrefix}state`} label="Estado" options={geo.states.data?.items ?? []} value={states} onChange={next => onChange(statePatch(query, next))} />
    <CatalogFeedback resource={geo.states} label="estados" />
    <MultiFilter id={`${idPrefix}municipality`} label="Municipio" options={municipalities} value={selectedValues(query.municipality)} onChange={municipality => onChange({ municipality })} disabled={!states.length} helper={!states.length ? "Elige uno o más estados primero." : "Puedes elegir municipios de los estados seleccionados."} />
    {states.map(state => <MunicipalityFeedback key={state} state={state} name={geo.states.data?.items.find(item => item.id === state)?.name ?? "los estados seleccionados"} />)}
    <MultiFilter id={`${idPrefix}work_mode`} label="Modalidad" options={MODES} value={selectedValues(query.work_mode)} onChange={work_mode => onChange({ work_mode })} />
    <Field><FieldLabel htmlFor={`${idPrefix}country`}>Postulo desde</FieldLabel>
      <Combobox items={countries} value={countries.find(item => item.id === query.applicant_country) ?? null} onValueChange={ignoreEscapeClear((item: GeoReference | null) => onChange({ applicant_country: item?.id ?? "" }))} itemToStringLabel={(item: GeoReference) => item.name} itemToStringValue={(item: GeoReference) => item.id} isItemEqualToValue={(a, b) => a.id === b.id}>
        <ComboboxInput id={`${idPrefix}country`} className="min-h-10" showClear aria-describedby={`${idPrefix}country-help`} />
        <ComboboxContent><ComboboxEmpty>Sin coincidencias.</ComboboxEmpty><ComboboxList>{(item: GeoReference) => <ComboboxItem key={item.id} value={item}>{item.name}</ComboboxItem>}</ComboboxList></ComboboxContent>
      </Combobox>
      <FieldDescription id={`${idPrefix}country-help`}>Muestra vacantes presenciales, híbridas y remotas que aceptan postulantes de este país.</FieldDescription>
      <CatalogFeedback resource={geo.countries} label="países" />
    </Field>
  </>;
}
export function JobsFilterChips({ query, geo, onRemove }: { query: JobsQuery; geo: JobsGeo; onRemove: (patch: JobsFilterPatch) => void }) {
  const dimensions = [
    { key: "state", label: "Estado", options: geo.states.data?.items ?? [] },
    { key: "municipality", label: "Municipio", options: Object.values(geo.municipalities).flatMap(data => data.items) },
    { key: "work_mode", label: "Modalidad", options: MODES },
    { key: "applicant_country", label: "Postulo desde", options: geo.countries.data?.items ?? [] },
    ...[{ key: "work_schedule", label: "Jornada", options: WORK_SCHEDULE_OPTIONS }, { key: "contract_type", label: "Tipo de contrato", options: CONTRACT_TYPE_OPTIONS }, { key: "professional_area", label: "Área profesional", options: PROFESSIONAL_AREA_OPTIONS }].map(item => ({ ...item, options: item.options.map(option => ({ id: option.value, name: option.label })) })),
    { key: "q", label: "Búsqueda", options: query.q ? [{ id: query.q, name: query.q }] : [] },
  ];
  return <div aria-label="Filtros activos" className="flex min-w-0 gap-2 overflow-x-auto">
    {dimensions.flatMap(({ key, label, options }) => selectedValues(query[key as keyof JobsQuery]).map(code => {
      const name = options.find(option => option.id === code)?.name;
      // Never substitute raw codes while the catalog is pending or unavailable.
      const text = `${label}: ${name ?? "Nombre no disponible"}`;
      return <Tooltip key={`${key}-${code}`}><TooltipTrigger render={<Button type="button" variant="outline" className="h-8 max-w-[300px] shrink-0" aria-label={`Quitar filtro ${text}`} onClick={() => onRemove(key === "state" ? statePatch(query, selectedValues(query.state).filter(value => value !== code)) : { [key]: ["municipality", "work_mode"].includes(key) ? selectedValues(query[key as keyof JobsQuery]).filter(value => value !== code) : "" })} />}><MapPinIcon aria-hidden="true" data-icon="inline-start" /><span className="min-w-0 truncate">{text}</span><XIcon aria-hidden="true" data-icon="inline-end" /></TooltipTrigger><TooltipContent>{text}</TooltipContent></Tooltip>;
    }))}
  </div>;
}

"use client";

import { editorPublicationRequirements } from "../pipeline/publication-model";
import { PublicationRequired } from "./publication-required";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Combobox, ComboboxChip, ComboboxChips, ComboboxChipsInput, ComboboxContent, ComboboxEmpty, ComboboxItem, ComboboxList, ComboboxValue, useComboboxAnchor } from "@/components/ui/combobox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LocationField } from "@/features/geo/location-field";
import { remoteScopeErrorMessages, type GeographyErrors, type GeoReference } from "@/features/geo/model";
import { useGeoCatalog } from "@/features/geo/use-geo-catalog";
import type { DraftFormState } from "./draft-form-state";

/** Official FieldSet and “With chips” composition. ToggleGroup is the installed
 * two-choice primitive; RadioGroup is not installed. Values stay in the parent
 * when work mode hides this control, and display names never enter the write DTO.
 */
export function DraftGeographyField({ state, onChange, errors, remoteError }: {
  state: DraftFormState;
  onChange: (patch: Partial<DraftFormState>) => void;
  errors?: GeographyErrors;
  remoteError?: string;
}) {
  const { countries } = useGeoCatalog(null, false);
  const anchor = useComboboxAnchor();
  const remote = state.work_mode === "remote";
  const required = editorPublicationRequirements(state);
  const issue = errors?.remoteScope[0];
  const message = issue ? remoteScopeErrorMessages[issue.reason] : remoteError;
  return <FieldGroup className="sm:col-span-2">
    {remote && <FieldSet id="draft-remote-scope" tabIndex={-1}>
      <FieldLegend id="draft-remote-scope-label">¿Desde dónde pueden postular? <PublicationRequired required={required.remoteScope} /></FieldLegend>
      <FieldDescription id="draft-remote-scope-help">Elige una opción para publicar la vacante.</FieldDescription>
      <FieldGroup>
        <Field data-invalid={!!message}>
          <ToggleGroup aria-labelledby="draft-remote-scope-label" aria-describedby="draft-remote-scope-help" variant="outline" className="grid w-full grid-cols-1 sm:grid-cols-2" value={state.remote_scope ? [state.remote_scope.kind] : []} onValueChange={values => {
            const kind = values[0];
            if (kind === "anywhere") onChange({ remote_scope: { kind } });
            if (kind === "countries") onChange({ remote_scope: { kind, countries: state.remoteCountries.map(country => country.id) } });
          }}>
            <ToggleGroupItem className="min-h-10 w-full" value="anywhere">Desde cualquier lugar</ToggleGroupItem>
            <ToggleGroupItem className="min-h-10 w-full" value="countries">Solo desde estos países</ToggleGroupItem>
          </ToggleGroup>
          {state.remote_scope?.kind !== "countries" && message && <FieldError>{message}</FieldError>}
        </Field>
        {state.remote_scope?.kind === "countries" && <Field data-invalid={!!message} aria-busy={countries.status === "loading"}>
          <FieldLabel htmlFor="draft-remote-countries">Países desde donde pueden postular <PublicationRequired required={required.remoteScope} /></FieldLabel>
          {countries.status === "loading" || countries.status === "idle" ? <><Skeleton className="h-10 w-full" /><span role="status">Cargando países</span></> : <Combobox multiple items={countries.data?.items ?? []} value={state.remoteCountries} itemToStringLabel={(country: GeoReference) => country.name} itemToStringValue={(country: GeoReference) => country.id} isItemEqualToValue={(a, b) => a.id === b.id} onValueChange={countries => {
            if (countries.length > 50 || new Set(countries.map(country => country.id)).size !== countries.length) return;
            onChange({ remoteCountries: countries, remote_scope: { kind: "countries", countries: countries.map(country => country.id) } });
          }}>
            <ComboboxChips ref={anchor} className="min-h-10"><ComboboxValue>{state.remoteCountries.map(country => <ComboboxChip key={country.id}>{country.name}</ComboboxChip>)}</ComboboxValue><ComboboxChipsInput id="draft-remote-countries" aria-required aria-invalid={!!message} aria-describedby={message ? "draft-remote-countries-error" : "draft-remote-countries-help"} /></ComboboxChips>
            <ComboboxContent anchor={anchor}><ComboboxEmpty>Sin coincidencias.</ComboboxEmpty><ComboboxList>{(country: GeoReference) => <ComboboxItem key={country.id} value={country} disabled={state.remoteCountries.length >= 50 && !state.remoteCountries.some(selected => selected.id === country.id)}>{country.name}</ComboboxItem>}</ComboboxList></ComboboxContent>
          </Combobox>}
          <FieldDescription id="draft-remote-countries-help">Elige entre 1 y 50 países.</FieldDescription>
          {message && <FieldError id="draft-remote-countries-error">{message}</FieldError>}
          {countries.status === "error" && <><FieldError>No pudimos cargar países.</FieldError><Button type="button" variant="outline" onClick={countries.retry}>Reintentar</Button></>}
        </Field>}
      </FieldGroup>
    </FieldSet>}
    <Separator />
    <section id="draft-location" tabIndex={-1} aria-label="Ubicación" className="flex flex-col gap-3">
      <LocationField value={state.location} onChange={location => onChange({ location, locationLabel: null })} depth="municipality" postalCode label={remote ? "Ubicación (opcional)" : "Ubicación"} hideLegend={!remote} layout="grid" requiredIndicator={<PublicationRequired />} description={remote ? "Para vacantes remotas la ubicación es opcional." : undefined}
        required={required.location} errors={errors?.location} />
      {remote && state.location.country && <Button type="button" variant="ghost" className="min-h-10 self-start" onClick={() => onChange({ location: { country: null, state: null, municipality: null, postal_code: null }, locationLabel: null })}>Quitar ubicación</Button>}
    </section>
  </FieldGroup>;
}

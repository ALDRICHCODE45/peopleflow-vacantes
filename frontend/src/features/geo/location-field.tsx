"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useGeoCatalog, useGeoPostalCode } from "./use-geo-catalog";
import { ignoreEscapeClear } from "./escape-clear";
import { locationErrorMessages, type Catalog, type GeoReference, type LocationValue } from "./model";

export type LocationFieldProps = {
  value: LocationValue;
  onChange: (value: LocationValue) => void;
  depth: "country" | "state" | "municipality";
  postalCode: boolean;
  required?: readonly (keyof LocationValue)[];
  label?: string;
  hideLegend?: boolean;
  /** Optional presentation for context-specific required markers; no validation change. */
  requiredIndicator?: ReactNode;
  layout?: "stack" | "grid";
  defaultCountry?: "MX" | null;
  description?: string;
  disabled?: boolean;
  errors?: readonly { field: string; reason: "required" | "unknown" | "mismatch" | "not_allowed" }[];
};
const removedPostal = "Quitamos el código postal porque no corresponde al municipio elegido.";
type CatalogState = { status: string; data?: Catalog; retry: () => void };

function CatalogField({ label, code, catalog, onChange, disabled, required, requiredIndicator, error }: {
  label: string; code: string | null; catalog: CatalogState; onChange: (code: string | null) => void;
  disabled?: boolean; required?: boolean; requiredIndicator?: ReactNode; error?: string;
}) {
  const id = useId();
  const loading = catalog.status === "loading" || catalog.status === "idle" && !disabled;
  const items = catalog.data?.items ?? [];
  const selected = items.find(item => item.id === code) ?? null;
  // Controlled text: the Combobox only derives its input from the value on mount, so a value set
  // later (the MX default, a postal-code preload) left the field visually empty. Keep them in sync.
  const [text, setText] = useState(selected?.name ?? "");
  const shown = selected?.name ?? "";
  useEffect(() => { setText(shown); }, [shown]);
  return <Field data-invalid={!!error} data-disabled={disabled} aria-busy={loading}>
    <FieldLabel htmlFor={id}>{label}{required && requiredIndicator}</FieldLabel>
    {loading ? <><Skeleton aria-hidden="true" className="h-10 w-full" /><span role="status" className="sr-only">Cargando {label.toLowerCase()}</span></> :
      <Combobox items={items} itemToStringLabel={(item: GeoReference) => item.name} itemToStringValue={(item: GeoReference) => item.id} isItemEqualToValue={(a, b) => a.id === b.id}
        value={selected} onValueChange={item => { if (item) onChange(item.id); }} inputValue={text} onInputValueChange={ignoreEscapeClear(setText)} disabled={disabled} autoHighlight>
        {/* Selecting the shown name on focus lets typing replace it instead of appending to it. */}
        <ComboboxInput id={id} placeholder={label === "País" ? "Elige un país" : `Elige ${label.toLowerCase()}`} className="min-h-10" onFocus={event => event.currentTarget.select()} disabled={disabled} aria-invalid={!!error} aria-required={required} aria-describedby={error ? `${id}-error` : undefined} triggerLabel={`Mostrar ${label.toLowerCase()}`} />
        <ComboboxContent><ComboboxEmpty>Sin coincidencias.</ComboboxEmpty><ComboboxList>{(item: GeoReference) => <ComboboxItem key={item.id} value={item}>{item.name}</ComboboxItem>}</ComboboxList></ComboboxContent>
      </Combobox>}
    {catalog.status === "error" && <><FieldError>No pudimos cargar {label.toLowerCase()}.</FieldError><Button type="button" variant="outline" className="min-h-10" disabled={disabled} onClick={catalog.retry}>Reintentar</Button></>}
    {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
  </Field>;
}

/** Official simple Combobox and FieldSet compositions: docs/design/shadcn-reference.
 * Postal resolution is offered only at municipality depth: a valid CP needs a pair.
 * Catalog labels never become write values; typing filters, it never creates an option.
 */
export function LocationField({ value, onChange, depth, postalCode, required = [], label = "Ubicación", hideLegend = false, requiredIndicator, layout = "stack", defaultCountry = "MX", description, disabled = false, errors = [] }: LocationFieldProps) {
  const cpId = useId();
  const mx = value.country === "MX";
  const detailed = mx && depth !== "country";
  const showPostal = mx && depth === "municipality" && postalCode;
  const catalog = useGeoCatalog(depth === "municipality" && mx ? value.state : null, detailed);
  const postal = useGeoPostalCode(showPostal ? value.postal_code : null);
  const [note, setNote] = useState(false);
  const applied = useRef<string | null>(null);
  const defaulted = useRef(value.country !== null);
  const error = (field: keyof LocationValue) => {
    const issue = errors.find(issue => issue.field.split(".").at(-1) === field);
    return issue ? locationErrorMessages[issue.reason] : undefined;
  };
  useEffect(() => {
    if (defaultCountry && !defaulted.current && !value.country && !disabled && catalog.countries.data?.items.some(item => item.id === "MX")) {
      defaulted.current = true;
      onChange({ country: "MX", state: null, municipality: null, postal_code: null });
    }
  }, [value.country, disabled, defaultCountry, catalog.countries.data, onChange]);
  useEffect(() => {
    if (!showPostal || !value.postal_code) { applied.current = null; return; }
    if (disabled || postal.data?.postal_code !== value.postal_code || applied.current === value.postal_code) return;
    applied.current = value.postal_code;
    if (postal.data.matches.length === 1) {
      const match = postal.data.matches[0];
      onChange({ ...value, state: match.state.id, municipality: match.municipality.id });
    }
  }, [showPostal, value, disabled, postal.data, onChange]);
  function subdivision(field: "state" | "municipality", code: string | null) {
    const next = { ...value, [field]: code, ...(field === "state" && code !== value.state ? { municipality: null } : {}) };
    // Unknown or still-pending CP mappings cannot authorize a changed pair either.
    if (next.postal_code && (next.state !== value.state || next.municipality !== value.municipality) && !postal.data?.matches.some(match => match.state.id === next.state && match.municipality.id === next.municipality)) {
      next.postal_code = null; setNote(true);
    }
    onChange(next);
  }
  const postalError = error("postal_code") ?? (postal.error === "postal_code_not_found" ? "No encontramos ese código postal." : postal.error ? "No pudimos consultar el código postal." : undefined);
  const matches = postal.data?.postal_code === value.postal_code ? postal.data.matches : [];
  return <FieldSet disabled={disabled}>
    <FieldLegend className={hideLegend ? "sr-only" : undefined}>{label}</FieldLegend>
    {description && <FieldDescription>{description}</FieldDescription>}
    <FieldGroup className={layout === "grid" ? "grid gap-6 sm:grid-cols-2 [&>*]:min-w-0" : undefined}>
      <CatalogField requiredIndicator={requiredIndicator} label="País" code={value.country} catalog={catalog.countries} disabled={disabled} required={required.includes("country")} error={error("country")}
        onChange={country => { setNote(false); onChange({ country, state: null, municipality: null, postal_code: null }); }} />
      {value.country && !mx && <FieldDescription className={layout === "grid" ? "sm:col-span-2" : undefined}>Por ahora solo detallamos ubicaciones en México.</FieldDescription>}
      {showPostal && <Field data-invalid={!!postalError} data-disabled={disabled}>
        <FieldLabel htmlFor={cpId}>Código postal</FieldLabel>
        <InputGroup className="min-h-10"><InputGroupInput id={cpId} inputMode="numeric" autoComplete="postal-code" maxLength={5} pattern="[0-9]{5}" disabled={disabled} required={required.includes("postal_code")} aria-invalid={!!postalError} aria-describedby={postalError ? `${cpId}-error` : `${cpId}-help`} value={value.postal_code ?? ""}
          onChange={event => { const cp = event.target.value; if (!/^[0-9]{0,5}$/.test(cp)) return; setNote(false); onChange({ ...value, postal_code: cp || null }); }} /></InputGroup>
        <FieldDescription id={`${cpId}-help`}>Completa estado y municipio; puedes cambiarlos.</FieldDescription>
        {postal.status === "loading" && <span role="status">Consultando código postal…</span>}
        {postalError && <FieldError id={`${cpId}-error`}>{postalError}</FieldError>}
        {postal.status === "error" && <Button type="button" variant="outline" className="min-h-10" disabled={disabled} onClick={postal.retry}>Reintentar</Button>}
        {matches.length > 1 && <><FieldDescription>Este código postal corresponde a varios municipios</FieldDescription>
          <CatalogField label="Municipio del código postal" code={value.municipality} disabled={disabled}
            catalog={{ status: "success", retry: postal.retry, data: { items: matches.map(match => ({ id: match.municipality.id, name: `${match.municipality.name}, ${match.state.name}` })) } }}
            onChange={code => { const match = matches.find(match => match.municipality.id === code); if (match) onChange({ ...value, state: match.state.id, municipality: match.municipality.id }); }} />
        </>}
      </Field>}
      {detailed && <FieldGroup className="grid grid-cols-1 gap-6 sm:col-span-2 sm:grid-cols-2 [&>*]:min-w-0">
        <CatalogField requiredIndicator={requiredIndicator} label="Estado" code={value.state} catalog={catalog.states} disabled={disabled} required={required.includes("state")} error={error("state")} onChange={code => subdivision("state", code)} />
        {depth === "municipality" && <CatalogField requiredIndicator={requiredIndicator} label="Municipio" code={value.municipality} catalog={catalog.municipalities} disabled={disabled || !value.state} required={required.includes("municipality")} error={error("municipality")} onChange={code => subdivision("municipality", code)} />}
      </FieldGroup>}
      {note && <FieldDescription role="status">{removedPostal}</FieldDescription>}
    </FieldGroup>
  </FieldSet>;
}

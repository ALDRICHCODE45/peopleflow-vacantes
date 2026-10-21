"use client";
import { useEffect, useId, useState } from "react";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CEFR_LEVELS, CEFR_LEVEL_LABELS, type CefrLevel } from "@/features/candidate/model";
import { ignoreEscapeClear } from "@/features/geo/escape-clear";
import { useLanguageCatalog } from "./use-language-catalog";
import type { LanguageOption } from "./model";

export type LanguageValue = { code: string; level: "" | CefrLevel };
type Issue = { path: string; message: string };
const levels = [{ value: null, label: "Sin especificar" }, ...CEFR_LEVELS.map(value => ({ value, label: CEFR_LEVEL_LABELS[value] }))];

/** Simple Combobox composition, matching LocationField: input text filters only. */
export function LanguageField({ value, onChange, excludedCodes = [], index = 0, disabled, issues = [], idPrefix }: {
  value: LanguageValue; onChange: (next: LanguageValue) => void; excludedCodes?: readonly string[];
  index?: number; disabled?: boolean; issues?: readonly Issue[]; idPrefix?: string;
}) {
  const generatedId = useId();
  const id = idPrefix ?? generatedId;
  const catalog = useLanguageCatalog();
  const items = (catalog.data?.items ?? []).filter(item => item.code === value.code || !excludedCodes.includes(item.code));
  const selected = items.find(item => item.code === value.code) ?? null;
  const shown = selected?.name ?? "";
  const [text, setText] = useState(shown);
  useEffect(() => { setText(shown); }, [shown]);
  const error = (key: "code" | "level") => issues.find(issue => issue.path === `languages.${index}.${key}`)?.message;
  const loading = catalog.status === "idle" || catalog.status === "loading";
  return <FieldGroup data-pf-profile-language-grid="" className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
    <Field data-invalid={!!error("code")} aria-busy={loading}>
      <FieldLabel htmlFor={`${id}-code`}>Idioma {index + 1}</FieldLabel>
      {loading ? <><Skeleton className="h-10 w-full" /><span role="status" className="sr-only">Cargando idiomas</span></> : <Combobox items={items} value={selected}
        itemToStringLabel={(item: LanguageOption) => item.name} itemToStringValue={(item: LanguageOption) => item.code} isItemEqualToValue={(a, b) => a.code === b.code}
        inputValue={text} onInputValueChange={ignoreEscapeClear(setText)} disabled={disabled || catalog.status !== "success"} autoHighlight
        onValueChange={item => { if (item && !excludedCodes.includes(item.code)) onChange({ ...value, code: item.code }); }}>
        <ComboboxInput id={`${id}-code`} data-pf-profile-field={`languages.${index}.code`} placeholder="Elige un idioma" triggerLabel="Mostrar idiomas" className="min-h-10" onFocus={event => event.currentTarget.select()} aria-invalid={!!error("code")} aria-describedby={error("code") ? `${id}-code-error` : undefined} />
        <ComboboxContent><ComboboxEmpty>Sin coincidencias.</ComboboxEmpty><ComboboxList>{(item: LanguageOption) => <ComboboxItem key={item.code} value={item}>{item.name}</ComboboxItem>}</ComboboxList></ComboboxContent>
      </Combobox>}
      {catalog.status === "error" && <><FieldError>No pudimos cargar los idiomas.</FieldError><Button type="button" variant="outline" disabled={disabled} onClick={catalog.retry}>Reintentar</Button></>}
      {error("code") && <FieldError id={`${id}-code-error`}>{error("code")}</FieldError>}
    </Field>
    <Field data-invalid={!!error("level")}>
      <FieldLabel htmlFor={`${id}-level`}>Nivel del idioma {index + 1}</FieldLabel>
      <Select items={levels} value={value.level || null} disabled={disabled} onValueChange={level => onChange({ ...value, level: level ?? "" })}>
        <SelectTrigger id={`${id}-level`} data-pf-profile-field={`languages.${index}.level`} className="min-h-10 w-full" aria-invalid={!!error("level")} aria-describedby={error("level") ? `${id}-level-error` : undefined}><SelectValue /></SelectTrigger>
        <SelectContent><SelectGroup>{levels.map(item => <SelectItem key={item.value ?? "blank"} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
      {error("level") && <FieldError id={`${id}-level-error`}>{error("level")}</FieldError>}
    </Field>
  </FieldGroup>;
}
export function LanguageListEditor({ value, onChange, disabled, issues = [] }: { value: readonly LanguageValue[]; onChange: (next: LanguageValue[]) => void; disabled?: boolean; issues?: readonly Issue[] }) {
  return <FieldGroup>
    {!value.length && <p className="text-sm text-muted-foreground">Sin idiomas agregados.</p>}
    {issues.find(issue => issue.path === "languages") && <FieldError>{issues.find(issue => issue.path === "languages")!.message}</FieldError>}
    {value.map((row, index) => <FieldSet key={index} data-pf-profile-language-row={index} disabled={disabled}>
      <FieldLegend className="sr-only">Idioma {index + 1}</FieldLegend>
      <LanguageField value={row} index={index} disabled={disabled} issues={issues} idPrefix={`profile-language-${index}`} excludedCodes={value.filter((_, i) => i !== index).map(item => item.code)} onChange={next => onChange(value.map((item, i) => i === index ? next : item))} />
      <Button type="button" variant="ghost" className="min-h-10 w-fit" aria-label={`Quitar idioma ${index + 1}`} data-pf-profile-language-remove disabled={disabled} onClick={() => onChange(value.filter((_, i) => i !== index))}>Quitar</Button>
    </FieldSet>)}
    <Button type="button" variant="outline" className="min-h-10 w-fit" data-pf-profile-language-add disabled={disabled || value.length >= 10} onClick={() => onChange([...value, { code: "", level: "" }])}>Agregar idioma</Button>
  </FieldGroup>;
}

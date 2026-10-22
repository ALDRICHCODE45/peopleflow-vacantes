"use client";
import { Fragment, useEffect, useId, useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "cn";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
// Each listed language needs a level: ask to choose one, never offer «Sin especificar».
const levels = CEFR_LEVELS.map(value => ({ value, label: CEFR_LEVEL_LABELS[value] }));

/** Simple Combobox composition, matching LocationField: input text filters only. */
export function LanguageField({ value, onChange, excludedCodes = [], index = 0, disabled, issues = [], idPrefix, levelLabel = "Nivel del idioma", removeAction }: {
  value: LanguageValue; onChange: (next: LanguageValue) => void; excludedCodes?: readonly string[];
  index?: number; disabled?: boolean; issues?: readonly Issue[]; idPrefix?: string; levelLabel?: string; removeAction?: ReactNode;
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
  return <FieldGroup data-pf-profile-language-grid="" className={cn("grid gap-3 [&>*]:min-w-0", removeAction ? "grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" : "grid-cols-1 sm:grid-cols-2")}>
    <Field data-invalid={!!error("code")} aria-busy={loading} className={removeAction ? "col-span-2 sm:col-span-1" : undefined}>
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
      <FieldLabel htmlFor={`${id}-level`}>{levelLabel} {index + 1}</FieldLabel>
      <Select items={levels} value={value.level || null} disabled={disabled} onValueChange={level => onChange({ ...value, level: level ?? "" })}>
        <SelectTrigger id={`${id}-level`} data-pf-profile-field={`languages.${index}.level`} className="min-h-10 w-full" aria-invalid={!!error("level")} aria-describedby={error("level") ? `${id}-level-error` : undefined}><SelectValue placeholder="Elige un nivel" /></SelectTrigger>
        <SelectContent><SelectGroup>{levels.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
      {error("level") && <FieldError id={`${id}-level-error`}>{error("level")}</FieldError>}
    </Field>
    {removeAction && <div className="self-start pt-7">{removeAction}</div>}
  </FieldGroup>;
}
export function LanguageListEditor({ value, onChange, disabled, issues = [], maxItems = 10, levelLabel }: { value: readonly LanguageValue[]; onChange: (next: LanguageValue[]) => void; disabled?: boolean; issues?: readonly Issue[]; maxItems?: number; levelLabel?: string }) {
  return <FieldGroup>
    {!value.length && <p className="text-sm text-muted-foreground">Sin idiomas agregados.</p>}
    {issues.find(issue => issue.path === "languages") && <FieldError>{issues.find(issue => issue.path === "languages")!.message}</FieldError>}
    {value.map((row, index) => <Fragment key={index}>
      {index > 0 && <Separator />}
      <FieldSet data-pf-profile-language-row={index} disabled={disabled}>
      <FieldLegend className="sr-only">Idioma {index + 1}</FieldLegend>
      <LanguageField removeAction={<Tooltip>
        <TooltipTrigger render={<Button type="button" variant="ghost" size="icon" className="size-10 text-destructive hover:text-destructive" aria-label={`Quitar idioma ${index + 1}`} data-pf-profile-language-remove disabled={disabled} onClick={() => onChange(value.filter((_, i) => i !== index))} />}><Trash2 aria-hidden="true" /></TooltipTrigger>
        <TooltipContent>Quitar</TooltipContent>
      </Tooltip>} value={row} index={index} levelLabel={levelLabel} disabled={disabled} issues={issues} idPrefix={`profile-language-${index}`} excludedCodes={value.filter((_, i) => i !== index).map(item => item.code)} onChange={next => onChange(value.map((item, i) => i === index ? next : item))} />
    </FieldSet></Fragment>)}
    <Button type="button" variant="outline" className="min-h-10 w-fit" data-pf-profile-language-add disabled={disabled || value.length >= maxItems} onClick={() => onChange([...value, { code: "", level: "" }])}>Agregar idioma</Button>
  </FieldGroup>;
}

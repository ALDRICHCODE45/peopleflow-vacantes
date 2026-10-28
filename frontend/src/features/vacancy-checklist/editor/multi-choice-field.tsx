"use client";
import { useId } from "react";
import { Combobox, ComboboxChip, ComboboxChips, ComboboxChipsInput, ComboboxContent, ComboboxEmpty, ComboboxItem, ComboboxList, ComboboxValue, useComboboxAnchor } from "@/components/ui/combobox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import type { Choice } from "./controls";
/** Official chips composition; the popup is anchored to the chips box. Primitive string values keep
 * selection identity stable when a catalog or the dependent question options are refreshed. */
export function MultiChoiceField({ label, options, value, onChange, error, disabled }: { label: string; options: Choice[]; value: string[]; onChange: (value: string[]) => void; error?: string; disabled?: boolean }) {
  const id = useId();
  const anchor = useComboboxAnchor();
  const display = (value: string) => options.find(item => item.value === value)?.label ?? "Opción ya no disponible";
  return <Field data-invalid={!!error} data-disabled={disabled}>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Combobox multiple items={options.map(item => item.value)} value={value} itemToStringLabel={display} onValueChange={items => { if (JSON.stringify(items) !== JSON.stringify(value)) onChange(items); }} disabled={disabled}>
      <ComboboxChips ref={anchor}><ComboboxValue>{value.map(item => <ComboboxChip key={item} aria-label={`Quitar ${display(item)}`}>{display(item)}</ComboboxChip>)}</ComboboxValue><ComboboxChipsInput id={id} placeholder="Elige opciones" aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} /></ComboboxChips>
      <ComboboxContent anchor={anchor}><ComboboxEmpty>Sin coincidencias.</ComboboxEmpty><ComboboxList>{(item: string) => <ComboboxItem key={item} value={item}>{display(item)}</ComboboxItem>}</ComboboxList></ComboboxContent>
    </Combobox>
    {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
  </Field>;
}

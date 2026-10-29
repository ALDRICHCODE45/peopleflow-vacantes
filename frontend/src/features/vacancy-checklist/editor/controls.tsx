"use client";
import { useId } from "react";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
export type Choice = { value: string; label: string };
/** Official simple composition (chips live in multi-choice-field.tsx, anchored to their box). Primitive string values keep selection identity
 * stable even when a catalog or the dependent question options are refreshed. */
export function ChoiceField({ label, options, value, onChange, error, disabled }: { label: string; options: Choice[]; value: string; onChange: (value: string) => void; error?: string; disabled?: boolean }) {
  const id = useId();
  const display = (value: string) => options.find(item => item.value === value)?.label ?? value;
  return <Field data-invalid={!!error} data-disabled={disabled}>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Combobox items={options.map(item => item.value)} value={value || null} itemToStringLabel={display} onValueChange={item => { if (item && item !== value) onChange(item); }} disabled={disabled}>
      <ComboboxInput id={id} className="min-h-10" placeholder="Elige una opción" aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} />
      <ComboboxContent><ComboboxEmpty>Sin coincidencias.</ComboboxEmpty><ComboboxList>{(item: string) => <ComboboxItem key={item} value={item}>{display(item)}</ComboboxItem>}</ComboboxList></ComboboxContent>
    </Combobox>
    {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
  </Field>;
}

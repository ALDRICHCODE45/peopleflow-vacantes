"use client";

import { useEffect, useState, type AriaAttributes } from "react";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, useComboboxAnchor } from "@/components/ui/combobox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { countryForDial, DIAL_CODES, type DialCode } from "@/lib/dial-codes";

const labelOf = (item: DialCode) => `${item.name} ${item.dial}`;
type Props = {
  id: string;
  value?: string;
  onChange: (dial: string) => void;
  disabled?: boolean;
  error?: string;
  description?: string;
  "aria-invalid"?: AriaAttributes["aria-invalid"];
  "aria-describedby"?: string;
  "data-pf-profile-field"?: string;
};

/** Country identity is local presentation state; only the dial crosses the form/API boundary. */
export function DialCodeField({ id, value = "+52", onChange, disabled, error, description, ...aria }: Props) {
  const anchor = useComboboxAnchor();
  const [chosen, setChosen] = useState<DialCode | null>(() => countryForDial(value));
  // A restored/reloaded dial invalidates the previous country's presentation.
  useEffect(() => {
    if (chosen?.dial !== value) setChosen(countryForDial(value));
  }, [value, chosen]);
  const selected = chosen?.dial === value ? chosen : countryForDial(value);
  const shown = selected ? labelOf(selected) : "";
  const [text, setText] = useState(shown);
  useEffect(() => { setText(shown); }, [shown]);
  const invalid = error ? true : aria["aria-invalid"];
  const describedBy = [aria["aria-describedby"], description && `${id}-help`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;

  return <Field data-invalid={invalid} data-disabled={disabled} className="min-w-0">
    <FieldLabel htmlFor={id}>Lada de país</FieldLabel>
    <Combobox items={DIAL_CODES} value={selected} itemToStringLabel={labelOf} itemToStringValue={item => item.country}
      isItemEqualToValue={(a, b) => a.country === b.country} inputValue={text}
      onInputValueChange={(next, details) => { if (details.reason !== "input-clear") setText(next); }}
      onValueChange={item => { if (item) { setChosen(item); setText(labelOf(item)); onChange(item.dial); } }} disabled={disabled} autoHighlight>
      <div ref={anchor} className="min-w-0 w-full">
        <ComboboxInput id={id} className="min-h-10 w-full" placeholder="Elige una lada" disabled={disabled}
          aria-invalid={invalid} aria-describedby={describedBy} data-pf-profile-field={aria["data-pf-profile-field"]}
          onFocus={event => event.currentTarget.select()} onBlur={() => setText(shown)} triggerLabel="Mostrar ladas de país" />
      </div>
      <ComboboxContent anchor={anchor} className="min-w-64"><ComboboxEmpty>Sin coincidencias.</ComboboxEmpty><ComboboxList>
        {(item: DialCode) => <ComboboxItem key={item.country} value={item}>{labelOf(item)}</ComboboxItem>}
      </ComboboxList></ComboboxContent>
    </Combobox>
    {description && <FieldDescription id={`${id}-help`}>{description}</FieldDescription>}
    {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
  </Field>;
}

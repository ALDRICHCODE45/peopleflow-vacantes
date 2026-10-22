"use client";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { LocationField, type LocationFieldProps } from "./location-field";
import { locationReadToValue } from "./model";

/** Clears an optional location; hosts with a card header can place it there instead. */
export function RemoveLocationButton({ onRemove, disabled }: { onRemove: () => void; disabled?: boolean }) {
  return <Button type="button" variant="ghost" className="min-h-10 text-destructive hover:text-destructive" aria-label="Quitar ubicación" disabled={disabled} onClick={onRemove}>
    <Trash2 data-icon="inline-start" aria-hidden="true" />Quitar
  </Button>;
}

/** Optional locations stay empty until a country is explicitly selected. */
export function OptionalLocationField({ value, onChange, disabled, inlineRemove = true, ...props }: LocationFieldProps & { inlineRemove?: boolean }) {
  return <FieldGroup>
    {inlineRemove && value.country !== null && <div className="flex justify-end">
      <RemoveLocationButton disabled={disabled} onRemove={() => onChange(locationReadToValue(null))} />
    </div>}
    <LocationField {...props} defaultCountry={null} value={value} onChange={onChange} disabled={disabled} />
  </FieldGroup>;
}

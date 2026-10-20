"use client";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { LocationField, type LocationFieldProps } from "./location-field";
import { locationReadToValue } from "./model";

/** Optional locations stay empty until a country is explicitly selected. */
export function OptionalLocationField({ value, onChange, disabled, ...props }: LocationFieldProps) {
  return <FieldGroup>
    <LocationField {...props} defaultCountry={null} value={value} onChange={onChange} disabled={disabled} />
    {value.country !== null && <Button type="button" variant="ghost" className="min-h-10 w-fit" disabled={disabled} onClick={() => onChange(locationReadToValue(null))}>
      Quitar ubicación
    </Button>}
  </FieldGroup>;
}

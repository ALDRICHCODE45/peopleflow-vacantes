"use client";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { LocationField, type LocationFieldProps } from "./location-field";
import { locationReadToValue } from "./model";

/** Explicit opt-in prevents the shared selector's MX default from silently
 * changing an optional empty location. Clearing retains no child codes. */
export function OptionalLocationField({ value, onChange, disabled, ...props }: LocationFieldProps) {
  const enabled = value.country !== null;
  return <FieldGroup>
    <LocationField {...props} value={value} onChange={onChange} disabled={disabled || !enabled} />
    <Button type="button" variant="outline" className="min-h-10 w-fit" disabled={disabled} onClick={() => onChange(enabled ? locationReadToValue(null) : { country: "MX", state: null, municipality: null, postal_code: null })}>
      {enabled ? "Quitar ubicación" : "Agregar ubicación"}
    </Button>
  </FieldGroup>;
}

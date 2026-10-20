"use client";

import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { LocationField } from "@/features/geo/location-field";
import { locationReadToValue, type LocationIssue, type LocationValue } from "@/features/geo/model";

/** Explicit opt-in prevents LocationField's MX default from saving an unchosen location. */
export function CompanyLocationField({ value, onChange, disabled, errors }: {
  value: LocationValue; onChange: (value: LocationValue) => void; disabled?: boolean; errors?: LocationIssue[];
}) {
  const enabled = value.country !== null;
  return <FieldGroup>
    <LocationField value={value} onChange={onChange} depth="municipality" postalCode label="Ubicación" description="Opcional." disabled={disabled || !enabled} errors={errors} />
    <Button type="button" variant="outline" className="min-h-10 w-fit" disabled={disabled} onClick={() => onChange(enabled ? locationReadToValue(null) : { country: "MX", state: null, municipality: null, postal_code: null })}>
      {enabled ? "Quitar ubicación" : "Agregar ubicación"}
    </Button>
  </FieldGroup>;
}

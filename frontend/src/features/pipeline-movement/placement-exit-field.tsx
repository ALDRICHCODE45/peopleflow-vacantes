"use client";

import { useId } from "react";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { PlacementExitReason } from "./model";

const options = [
  { value: "moved_by_mistake", label: "Lo moví por error", helper: "El placement se anula y no cuenta en las métricas." },
  { value: "candidate_left", label: "El candidato se fue", helper: "Renunció, no se presentó o se cayó después. Cuenta como placement que no se sostuvo." },
] as const;

/** The existing confirmation owns submission; this field never opens another dialog.
 * §24 explicitly uses a responsive grid for short mutually exclusive choices.
 * Each layout wrapper keeps the option's helper beside its control on mobile. */
export function PlacementExitField({ value, onChange, disabled }: { value?: PlacementExitReason; onChange: (value?: PlacementExitReason) => void; disabled: boolean }) {
  const id = useId();
  return <Field data-disabled={disabled}>
    <FieldLabel id={`${id}-label`}>¿Qué pasó con este placement?</FieldLabel>
    <ToggleGroup aria-labelledby={`${id}-label`} value={value ? [value] : []} onValueChange={values => onChange(options.find(option => option.value === values[0])?.value)} disabled={disabled} variant="outline" className="grid w-full grid-cols-1 sm:grid-cols-2">
      {options.map(option => <div key={option.value} className="flex min-w-0 flex-col gap-2 self-start">
        {/* The outline pressed state (bg-muted) is nearly invisible in dark mode; tint it like checked rows (§19). */}
        <ToggleGroupItem className="w-full aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-foreground" value={option.value} aria-describedby={`${id}-${option.value}`}>{option.label}</ToggleGroupItem>
        <FieldDescription id={`${id}-${option.value}`}>{option.helper}</FieldDescription>
      </div>)}
    </ToggleGroup>
  </Field>;
}

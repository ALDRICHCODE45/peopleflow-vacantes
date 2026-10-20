"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { BENEFITS } from "../lists";
import { toggleBenefit } from "./draft-form-state";
import { benefitLabel } from "./draft-labels";

/**
 * Fixed-catalog benefit selection. The eight approved codes render as explicit
 * checkboxes in catalog order; toggling preserves the submitted selection order
 * and unknown codes can never enter the value.
 */
export type DraftBenefitsFieldProps = {
  selected: string[];
  onChange: (selected: string[]) => void;
};

export function DraftBenefitsField({ selected, onChange }: DraftBenefitsFieldProps) {
  return (
    <FieldSet><FieldLegend>Prestaciones</FieldLegend>
    <FieldGroup className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
      {BENEFITS.map((code) => {
        const id = `draft-benefit-${code}`;
        return (
          <Field key={code} orientation="horizontal" className="min-h-10">
            <Checkbox
              id={id}
              checked={selected.includes(code)}
              onCheckedChange={() => onChange(toggleBenefit(selected, code))}
            />
            <FieldLabel htmlFor={id} className="font-normal">
              {benefitLabel(code)}
            </FieldLabel>
          </Field>
        );
      })}
    </FieldGroup></FieldSet>
  );
}

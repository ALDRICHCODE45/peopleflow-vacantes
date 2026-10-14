"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
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
    <FieldGroup className="gap-3">
      {BENEFITS.map((code) => {
        const id = `draft-benefit-${code}`;
        return (
          <Field key={code} orientation="horizontal">
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
    </FieldGroup>
  );
}

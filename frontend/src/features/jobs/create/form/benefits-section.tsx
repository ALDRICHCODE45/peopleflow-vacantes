import { GiftIcon } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FormSection } from "./controls";
import { BENEFIT_OPTIONS, PAY_FREQUENCY_OPTIONS } from "./prototype-model";
import type { BenefitKey, PayFrequency, VacancyPrototypeValues } from "./prototype-model";

/**
 * Local-only benefits and pay frequency.
 *
 * The benefit set is a structured checkbox group built from the shared catalog,
 * and the pay frequency is a documented option-set control; both keep the value
 * with the caller and write nothing anywhere.
 */

const PAY_FREQUENCY_TITLE_ID = "vacancy-pay-frequency-title";

/** Narrows an option-set value back to the prototype pay frequency. */
function pickPayFrequency(candidate: string | undefined): PayFrequency | "" {
  return (
    PAY_FREQUENCY_OPTIONS.find((option) => option.value === candidate)?.value ??
    ""
  );
}

export type BenefitsSectionProps = {
  /** Caller-owned local-only prototype state. */
  values: VacancyPrototypeValues;
  onChange: (next: VacancyPrototypeValues) => void;
};

export function BenefitsSection({ values, onChange }: BenefitsSectionProps) {
  function toggleBenefit(key: BenefitKey) {
    const selected = new Set<BenefitKey>(values.benefits);
    if (selected.has(key)) selected.delete(key);
    else selected.add(key);

    // Catalog order keeps the value stable no matter the click order.
    onChange({
      ...values,
      benefits: BENEFIT_OPTIONS.filter((option) => selected.has(option.value)).map(
        (option) => option.value,
      ),
    });
  }

  return (
    <FormSection icon={GiftIcon} title="Beneficios y frecuencia de pago">
      <FieldGroup className="gap-6">
        <FieldSet>
          <FieldLegend>Beneficios</FieldLegend>
          <FieldGroup className="gap-3">
            {BENEFIT_OPTIONS.map((option) => (
              <Field key={option.value} orientation="horizontal">
                <Checkbox
                  id={`vacancy-benefit-${option.value}`}
                  checked={values.benefits.includes(option.value)}
                  onCheckedChange={() => toggleBenefit(option.value)}
                />
                <FieldLabel htmlFor={`vacancy-benefit-${option.value}`}>
                  {option.label}
                </FieldLabel>
              </Field>
            ))}
          </FieldGroup>
        </FieldSet>

        <Field>
          <FieldTitle id={PAY_FREQUENCY_TITLE_ID}>Frecuencia de pago</FieldTitle>
          <ToggleGroup
            aria-labelledby={PAY_FREQUENCY_TITLE_ID}
            className="flex-wrap"
            value={values.payFrequency === "" ? [] : [values.payFrequency]}
            onValueChange={(next) =>
              onChange({ ...values, payFrequency: pickPayFrequency(next[0]) })
            }
          >
            {PAY_FREQUENCY_OPTIONS.map((option) => (
              <ToggleGroupItem
                key={option.value}
                value={option.value}
                variant="outline"
                size="sm"
              >
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
      </FieldGroup>
    </FormSection>
  );
}

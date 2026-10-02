import { useState } from "react";

import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
} from "@/components/ui/combobox";
import { Field, FieldDescription, FieldGroup, FieldTitle } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BENEFIT_OPTIONS, PAY_FREQUENCY_OPTIONS } from "./prototype-model";
import type {
  BenefitKey,
  PayFrequency,
  VacancyPrototypeValues,
} from "./prototype-model";

/**
 * Local-only benefits and pay frequency.
 *
 * The benefit set is one searchable multiple combobox built from the shared
 * catalog, and the pay frequency is a documented single choice control; both
 * keep the value with the caller and write nothing anywhere. The module owns no
 * card: the wizard step shell renders the step surface once.
 */

const BENEFITS_TITLE_ID = "vacancy-benefits-title";
const BENEFITS_INPUT_ID = "vacancy-benefits";
const PAY_FREQUENCY_TITLE_ID = "vacancy-pay-frequency-title";

/** One catalog entry: the stored key paired with the Spanish label shown. */
type BenefitOption = (typeof BENEFIT_OPTIONS)[number];

/** Spanish label of one catalog benefit; the key itself is never shown raw. */
function benefitLabel(key: BenefitKey): string {
  return BENEFIT_OPTIONS.find((option) => option.value === key)?.label ?? key;
}

/**
 * Resolves the stored key behind either shape the combobox compares: the
 * catalog entry the list is built from, or the plain key the caller owns.
 */
function benefitKeyOf(item: BenefitKey | BenefitOption): BenefitKey {
  return typeof item === "string" ? item : item.value;
}

/** Narrows a select value back to the prototype pay frequency. */
function pickPayFrequency(
  candidate: string | null | undefined,
): PayFrequency | "" {
  return (
    PAY_FREQUENCY_OPTIONS.find((option) => option.value === candidate)?.value ??
    ""
  );
}

/**
 * Catalog order keeps the value stable no matter the click order, and unknown
 * keys never reach the caller's state.
 */
function normalizeBenefits(selected: readonly BenefitKey[]): BenefitKey[] {
  const chosen = new Set<BenefitKey>(selected);
  return BENEFIT_OPTIONS.filter((option) => chosen.has(option.value)).map(
    (option) => option.value,
  );
}

export type BenefitsSectionProps = {
  /** Caller-owned local-only prototype state. */
  values: VacancyPrototypeValues;
  onChange: (next: VacancyPrototypeValues) => void;
};

export function BenefitsSection({ values, onChange }: BenefitsSectionProps) {
  // The display follows the model's catalog-order invariant, and a derived copy
  // keeps the caller's own array untouched.
  const selectedBenefits = normalizeBenefits(values.benefits);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("es");
  // Control the displayed collection so a closing popup's retained query cannot
  // override the text currently entered by the user.
  const filteredBenefits = BENEFIT_OPTIONS.filter((option) =>
    option.label.toLocaleLowerCase("es").includes(normalizedQuery),
  );

  return (
    <FieldGroup className="gap-6">
        <Field className="gap-3" aria-labelledby={BENEFITS_TITLE_ID}>
          <FieldTitle id={BENEFITS_TITLE_ID}>Beneficios</FieldTitle>
          <Combobox
            multiple
            items={BENEFIT_OPTIONS}
            filteredItems={filteredBenefits}
            inputValue={query}
            onInputValueChange={setQuery}
            value={selectedBenefits}
            // The list compares catalog entries, the caller keeps plain keys: the
            // shared key keeps selection and highlight stable in both directions.
            isItemEqualToValue={(itemValue, value) =>
              benefitKeyOf(itemValue) === value
            }
            onValueChange={(next: BenefitKey[]) =>
              onChange({ ...values, benefits: normalizeBenefits(next) })
            }
          >
            <ComboboxChips className="min-h-10">
              <ComboboxValue>
                {(selected: BenefitKey[]) => (
                  <>
                    {selected.map((key) => (
                      <ComboboxChip key={key}>{benefitLabel(key)}</ComboboxChip>
                    ))}
                    <ComboboxChipsInput
                      id={BENEFITS_INPUT_ID}
                      aria-labelledby={BENEFITS_TITLE_ID}
                      placeholder="Busca un beneficio"
                    />
                  </>
                )}
              </ComboboxValue>
            </ComboboxChips>
            <ComboboxContent>
              <ComboboxEmpty>Sin resultados</ComboboxEmpty>
              <ComboboxList>
                {(option: BenefitOption) => (
                  <ComboboxItem key={option.value} value={option.value}>
                    {option.label}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          <FieldDescription>
            {values.benefits.length} de {BENEFIT_OPTIONS.length} beneficios
            seleccionados.
          </FieldDescription>
        </Field>

        <Field>
          <FieldTitle id={PAY_FREQUENCY_TITLE_ID}>Frecuencia de pago</FieldTitle>
          <Select
            value={values.payFrequency === "" ? null : values.payFrequency}
            items={PAY_FREQUENCY_OPTIONS}
            onValueChange={(next) =>
              onChange({ ...values, payFrequency: pickPayFrequency(next) })
            }
          >
            <SelectTrigger
              aria-labelledby={PAY_FREQUENCY_TITLE_ID}
              className="h-10 w-full"
            >
              <SelectValue placeholder="Elige una frecuencia" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {PAY_FREQUENCY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </FieldGroup>
  );
}

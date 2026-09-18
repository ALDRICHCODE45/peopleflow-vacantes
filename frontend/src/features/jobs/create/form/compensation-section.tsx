import { WalletIcon } from "lucide-react";

import { FieldGroup } from "@/components/ui/field";
import type { SalaryCurrency } from "../../formatters";
import { FormSection, OptionField, TextField } from "./controls";
import { SALARY_CURRENCY_OPTIONS } from "./model";
import type { VacancyFieldErrors } from "./model";

export type CompensationSectionProps = {
  salaryCurrency: SalaryCurrency;
  salaryMin: string;
  salaryMax: string;
  /** Shared error slots; this section only reads the fields it owns. */
  errors: VacancyFieldErrors;
  onChangeSalaryCurrency: (value: SalaryCurrency) => void;
  onChangeSalaryMin: (value: string) => void;
  onChangeSalaryMax: (value: string) => void;
};

/**
 * Currency plus the two optional salary bounds. Only MXN and USD exist in the
 * contract, and there is no "show salary publicly" switch to render because the
 * API has no such field.
 */
export function CompensationSection({
  salaryCurrency,
  salaryMin,
  salaryMax,
  errors,
  onChangeSalaryCurrency,
  onChangeSalaryMin,
  onChangeSalaryMax,
}: CompensationSectionProps) {
  return (
    <FormSection icon={WalletIcon} title="Compensación">
      <FieldGroup className="gap-4">
        <OptionField
          field="salary_currency"
          title="Moneda"
          options={SALARY_CURRENCY_OPTIONS}
          value={salaryCurrency}
          error={errors.salary_currency}
          onChange={(value) =>
            // An unchosen currency falls back to the backend default, never to "".
            onChangeSalaryCurrency(value === "" ? "MXN" : value)
          }
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            field="salary_min"
            label="Salario mínimo"
            optional
            inputMode="numeric"
            value={salaryMin}
            error={errors.salary_min}
            onChange={onChangeSalaryMin}
            placeholder="Ej.: 25000"
          />
          <TextField
            field="salary_max"
            label="Salario máximo"
            optional
            inputMode="numeric"
            value={salaryMax}
            error={errors.salary_max}
            onChange={onChangeSalaryMax}
            placeholder="Ej.: 40000"
          />
        </div>
      </FieldGroup>
    </FormSection>
  );
}

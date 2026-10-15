"use client";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DraftCompensationState, DraftFormErrors } from "./draft-form-state";
import {
  BASIS_OPTIONS,
  COMPENSATION_MODE_OPTIONS,
  CURRENCY_OPTIONS,
  PAY_PERIOD_OPTIONS,
} from "./draft-labels";

/**
 * Compensation controls.
 *
 * Every amount is the exact typed string and is never converted to a number.
 * Only the fields of the active mode are composed; the inactive controls keep
 * their raw buffers in the editor state so changing the mode never erases what
 * the user typed.
 */
export type DraftCompensationFieldProps = {
  value: DraftCompensationState;
  errors: DraftFormErrors;
  onChange: (patch: Partial<DraftCompensationState>) => void;
};

export function DraftCompensationField({
  value,
  errors,
  onChange,
}: DraftCompensationFieldProps) {
  return (
    <FieldGroup className="gap-4">
      <Field>
        <FieldTitle id="draft-compensation-mode-label">Modo de compensación</FieldTitle>
        <Select
          value={value.mode === "" ? null : value.mode}
          items={COMPENSATION_MODE_OPTIONS}
          onValueChange={(next) => onChange({ mode: next ?? "" })}
        >
          <SelectTrigger
            id="draft-compensation-mode"
            aria-labelledby="draft-compensation-mode-label"
            className="h-10 w-full"
          >
            <SelectValue placeholder="Elige un modo" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {COMPENSATION_MODE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>

      {value.mode === "fixed" ? (
        <Field data-invalid={errors["compensation.amount"] !== undefined}>
          <FieldLabel htmlFor="draft-compensation-amount">Monto</FieldLabel>
          <Input
            id="draft-compensation-amount"
            name="draft-compensation-amount"
            value={value.amount}
            inputMode="decimal"
            autoComplete="off"
            placeholder="Ej. 30000.50"
            aria-invalid={errors["compensation.amount"] !== undefined}
            aria-describedby={
              errors["compensation.amount"] === undefined
                ? undefined
                : "draft-compensation-amount-error"
            }
            onChange={(event) => onChange({ amount: event.target.value })}
          />
          <FieldError id="draft-compensation-amount-error">
            {errors["compensation.amount"]}
          </FieldError>
        </Field>
      ) : null}

      {value.mode === "range" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={errors["compensation.min"] !== undefined}>
            <FieldLabel htmlFor="draft-compensation-min">Mínimo</FieldLabel>
            <Input
              id="draft-compensation-min"
              name="draft-compensation-min"
              value={value.min}
              inputMode="decimal"
              autoComplete="off"
              placeholder="Ej. 30000.00"
              aria-invalid={errors["compensation.min"] !== undefined}
              aria-describedby={
                errors["compensation.min"] === undefined
                  ? undefined
                  : "draft-compensation-min-error"
              }
              onChange={(event) => onChange({ min: event.target.value })}
            />
            <FieldError id="draft-compensation-min-error">
              {errors["compensation.min"]}
            </FieldError>
          </Field>
          <Field data-invalid={errors["compensation.max"] !== undefined}>
            <FieldLabel htmlFor="draft-compensation-max">Máximo</FieldLabel>
            <Input
              id="draft-compensation-max"
              name="draft-compensation-max"
              value={value.max}
              inputMode="decimal"
              autoComplete="off"
              placeholder="Ej. 45000.00"
              aria-invalid={errors["compensation.max"] !== undefined}
              aria-describedby={
                errors["compensation.max"] === undefined
                  ? undefined
                  : "draft-compensation-max-error"
              }
              onChange={(event) => onChange({ max: event.target.value })}
            />
            <FieldError id="draft-compensation-max-error">
              {errors["compensation.max"]}
            </FieldError>
          </Field>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field>
          <FieldTitle id="draft-compensation-currency-label">Moneda</FieldTitle>
          <Select
            value={value.currency === "" ? null : value.currency}
            items={CURRENCY_OPTIONS}
            onValueChange={(next) => onChange({ currency: next ?? "" })}
          >
            <SelectTrigger
              id="draft-compensation-currency"
              aria-labelledby="draft-compensation-currency-label"
              className="h-10 w-full"
            >
              <SelectValue placeholder="Sin definir" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {CURRENCY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldTitle id="draft-compensation-period-label">Periodo de pago</FieldTitle>
          <Select
            value={value.pay_period === "" ? null : value.pay_period}
            items={PAY_PERIOD_OPTIONS}
            onValueChange={(next) => onChange({ pay_period: next ?? "" })}
          >
            <SelectTrigger
              id="draft-compensation-period"
              aria-labelledby="draft-compensation-period-label"
              className="h-10 w-full"
            >
              <SelectValue placeholder="Sin definir" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {PAY_PERIOD_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldTitle id="draft-compensation-basis-label">Base</FieldTitle>
          <Select
            value={value.basis === "" ? null : value.basis}
            items={BASIS_OPTIONS}
            onValueChange={(next) => onChange({ basis: next ?? "" })}
          >
            <SelectTrigger
              id="draft-compensation-basis"
              aria-labelledby="draft-compensation-basis-label"
              className="h-10 w-full"
            >
              <SelectValue placeholder="Sin definir" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {BASIS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field orientation="horizontal">
        <Checkbox
          id="draft-compensation-visible"
          checked={value.public_visible}
          onCheckedChange={(checked) => onChange({ public_visible: checked === true })}
        />
        <FieldLabel htmlFor="draft-compensation-visible" className="font-normal">
          Mostrar la compensación cuando se publique la vacante
        </FieldLabel>
      </Field>
    </FieldGroup>
  );
}

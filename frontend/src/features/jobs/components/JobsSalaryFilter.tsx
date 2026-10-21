"use client";

import { BanknoteIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { COMPENSATION_MONEY_PATTERN } from "../drafts/compensation";
import { BASIS_OPTIONS, CURRENCY_OPTIONS, PAY_PERIOD_OPTIONS } from "../drafts/ui/draft-labels";
import { DEFAULT_SALARY_UNITS, SALARY_AMOUNT_KEYS, type JobsFilterPatch, type JobsQuery } from "../url";

export const CLEAR_SALARY_FILTER = { salary_min: "", salary_max: "", salary_currency: "", salary_period: "", salary_basis: "" } as const;
export type SalaryErrors = Partial<Record<(typeof SALARY_AMOUNT_KEYS)[number], string>>;

export function validateSalaryFilter(query: JobsQuery): SalaryErrors {
  const errors: SalaryErrors = {};
  for (const key of SALARY_AMOUNT_KEYS) {
    if (query[key] && !COMPENSATION_MONEY_PATTERN.test(query[key])) {
      errors[key] = "Escribe un monto sin comas ni signos, con hasta dos decimales.";
    }
  }
  if (!Object.keys(errors).length && query.salary_min && query.salary_max && Number(query.salary_min) > Number(query.salary_max)) {
    errors.salary_max = "El salario hasta debe ser mayor o igual al salario desde.";
  }
  return errors;
}

export function hasSalaryFilter(query: JobsQuery): boolean {
  return Boolean(query.salary_min || query.salary_max);
}

// The trigger shows the currency code so it fits the narrow sidebar; the list
// still names each currency in full.
const CURRENCY_CODES = CURRENCY_OPTIONS.map(option => ({ value: option.value, label: option.value, name: option.label }));

const UNIT_FIELDS = [
  { key: "salary_currency", label: "Moneda", options: CURRENCY_CODES },
  { key: "salary_period", label: "Periodo de pago", options: PAY_PERIOD_OPTIONS },
  { key: "salary_basis", label: "Base salarial", options: BASIS_OPTIONS },
] as const;

/** Both surfaces edit the same draft; only the island's Apply action commits it. */
export function JobsSalaryFilter({ idPrefix, query, onChange, errors }: {
  idPrefix: string;
  query: JobsQuery;
  onChange: (patch: JobsFilterPatch) => void;
  errors: SalaryErrors;
}) {
  return <FieldSet>
    <FieldLegend variant="label"><BanknoteIcon aria-hidden="true" className="inline size-4" /> Salario</FieldLegend>
    <FieldDescription>Puedes indicar uno o ambos montos. Los límites están incluidos.</FieldDescription>
    <FieldGroup>
      {SALARY_AMOUNT_KEYS.map((key, index) => {
        const id = `${idPrefix}${key}`;
        return <Field key={key} data-invalid={Boolean(errors[key])}>
          <FieldLabel htmlFor={id}>{index === 0 ? "Salario desde" : "Salario hasta"}</FieldLabel>
          <InputGroup className="min-h-10">
            <InputGroupInput id={id} name={key} inputMode="decimal" value={query[key] ?? ""} onChange={event => onChange({ [key]: event.target.value })} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `${id}-error` : undefined} className="min-h-10" />
            <InputGroupAddon aria-hidden="true">$</InputGroupAddon>
          </InputGroup>
          {errors[key] && <FieldError id={`${id}-error`}>{errors[key]}</FieldError>}
        </Field>;
      })}
      {UNIT_FIELDS.map(({ key, label, options }) => <Field key={key}>
        <FieldLabel htmlFor={`${idPrefix}${key}`}>{label}</FieldLabel>
        <Select name={key} items={options} value={query[key] || DEFAULT_SALARY_UNITS[key]} onValueChange={value => onChange({ [key]: value ?? DEFAULT_SALARY_UNITS[key] })}>
          <SelectTrigger id={`${idPrefix}${key}`} className="min-h-10 w-full"><SelectValue /></SelectTrigger>
          <SelectContent className="min-w-max"><SelectGroup>{options.map(option => <SelectItem key={option.value} value={option.value} className="min-h-10">{"name" in option ? option.name : option.label}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
      </Field>)}
    </FieldGroup>
  </FieldSet>;
}

export function JobsSalaryFilterChip({ query, onRemove }: { query: JobsQuery; onRemove: (patch: JobsFilterPatch) => void }) {
  if (!hasSalaryFilter(query)) return null;
  const money = (value: string) => `$${Number(value).toLocaleString("es-MX", { maximumFractionDigits: 2 })}`;
  const { salary_min: min, salary_max: max } = query;
  const range = min && max ? `${money(min)}–${money(max)}` : min ? `Desde ${money(min)}` : `Hasta ${money(max!)}`;
  const period = PAY_PERIOD_OPTIONS.find(option => option.value === (query.salary_period || DEFAULT_SALARY_UNITS.salary_period))!.label.toLowerCase();
  const basis = BASIS_OPTIONS.find(option => option.value === (query.salary_basis || DEFAULT_SALARY_UNITS.salary_basis))!.label.toLowerCase();
  const text = `Salario: ${range} ${query.salary_currency || DEFAULT_SALARY_UNITS.salary_currency} ${period} ${basis}`;
  return <Tooltip>
    <TooltipTrigger render={<Button type="button" variant="outline" className="h-8 max-w-[300px] shrink-0" aria-label={`Quitar filtro ${text}`} onClick={() => onRemove(CLEAR_SALARY_FILTER)} />}>
      <BanknoteIcon aria-hidden="true" data-icon="inline-start" /><span className="min-w-0 truncate">{text}</span><XIcon aria-hidden="true" data-icon="inline-end" />
    </TooltipTrigger>
    <TooltipContent>{text}</TooltipContent>
  </Tooltip>;
}

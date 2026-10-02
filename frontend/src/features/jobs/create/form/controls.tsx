import * as React from "react";

import {
  Field,
  FieldError,
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
import { controlId, errorId, groupTitleId, pickOption } from "./model";
import type { VacancyField } from "./model";

/**
 * Shared form presentation controls: the two contract-field controls. Each
 * control owns only its own accessibility wiring (label, error slot, aria
 * state); value state and validation stay in the model and the composition
 * root. Section chrome belongs to the shared `FormSectionCard`.
 */

export type TextFieldProps = {
  field: VacancyField;
  label: string;
  optional?: boolean;
  value: string;
  /** Present only while this field is invalid, so `aria-invalid` stays truthful. */
  error?: string;
  placeholder: string;
  inputMode?: React.ComponentProps<"input">["inputMode"];
  onChange: (value: string) => void;
};

/** One-line text control, wiring its label, error slot, and aria state. */
export function TextField({
  field,
  label,
  optional = false,
  value,
  error,
  placeholder,
  inputMode,
  onChange,
}: TextFieldProps) {
  const invalid = error !== undefined;

  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={controlId(field)}>
        {label}
        {optional && <span className="text-muted-foreground">(opcional)</span>}
      </FieldLabel>
      <Input
        id={controlId(field)}
        name={field}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId(field) : undefined}
        placeholder={placeholder}
        autoComplete="off"
        inputMode={inputMode}
        className="text-foreground"
      />
      <FieldError id={errorId(field)}>{error}</FieldError>
    </Field>
  );
}

/** Placeholder shown until the recruiter chooses one option. */
const EMPTY_OPTION_LABEL = "Elige una opción";

export type OptionFieldProps<T extends string> = {
  field: VacancyField;
  title: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T | "";
  /** Present only while this field is invalid, so `aria-invalid` stays truthful. */
  error?: string;
  onChange: (value: T | "") => void;
};

/**
 * Controlled single-choice control for one contract enum: the installed Select
 * keeps every option behind one trigger, so the form shows the chosen value
 * instead of an always-visible option grid.
 */
export function OptionField<T extends string>({
  field,
  title,
  options,
  value,
  error,
  onChange,
}: OptionFieldProps<T>) {
  const invalid = error !== undefined;

  return (
    <Field data-invalid={invalid}>
      <FieldTitle id={groupTitleId(field)}>{title}</FieldTitle>
      <Select
        value={value === "" ? null : value}
        items={options}
        onValueChange={(next) => onChange(pickOption(options, next ?? undefined))}
      >
        <SelectTrigger
          id={controlId(field)}
          aria-labelledby={groupTitleId(field)}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId(field) : undefined}
          className="h-10 w-full text-foreground"
        >
          <SelectValue placeholder={EMPTY_OPTION_LABEL} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <FieldError id={errorId(field)}>{error}</FieldError>
    </Field>
  );
}

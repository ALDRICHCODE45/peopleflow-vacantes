import * as React from "react";

import {
  Field,
  FieldError,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ChoiceGrid, ChoiceGridItem } from "./choice-grid";
import type { ChoiceGridColumns } from "./choice-grid";
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
      />
      <FieldError id={errorId(field)}>{error}</FieldError>
    </Field>
  );
}

export type OptionFieldProps<T extends string> = {
  field: VacancyField;
  title: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  /** Choice columns from `sm` up; the grid is one column on phones. */
  columns?: ChoiceGridColumns;
  value: T | "";
  /** Present only while this field is invalid, so `aria-invalid` stays truthful. */
  error?: string;
  onChange: (value: T | "") => void;
};

/** Segmented single-choice control for one contract enum. */
export function OptionField<T extends string>({
  field,
  title,
  options,
  columns,
  value,
  error,
  onChange,
}: OptionFieldProps<T>) {
  const invalid = error !== undefined;

  return (
    <Field data-invalid={invalid}>
      <FieldTitle id={groupTitleId(field)}>{title}</FieldTitle>
      <ChoiceGrid
        id={controlId(field)}
        columns={columns}
        aria-labelledby={groupTitleId(field)}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId(field) : undefined}
        value={value === "" ? [] : [value]}
        onValueChange={(next) => onChange(pickOption(options, next[0]))}
      >
        {options.map((option) => (
          <ChoiceGridItem
            key={option.value}
            value={option.value}
            variant="outline"
            size="sm"
          >
            {option.label}
          </ChoiceGridItem>
        ))}
      </ChoiceGrid>
      <FieldError id={errorId(field)}>{error}</FieldError>
    </Field>
  );
}

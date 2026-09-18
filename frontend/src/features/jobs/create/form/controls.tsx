import * as React from "react";
import type { LucideIcon } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldError,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { controlId, errorId, groupTitleId, pickOption } from "./model";
import type { VacancyField } from "./model";

/**
 * Shared form presentation controls: the compact section shell plus the two
 * contract-field controls. Each control owns only its own accessibility wiring
 * (label, error slot, aria state); value state and validation stay in the model
 * and the composition root.
 */

export type FormSectionProps = {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
};

/** Compact card shell shared by the three contract sections. */
export function FormSection({ icon: Icon, title, children }: FormSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="grid size-8 place-items-center rounded-xl bg-primary/10 text-primary"
          >
            <Icon className="size-4" />
          </span>
          <h2 className="font-heading text-base font-medium">{title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

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
  value,
  error,
  onChange,
}: OptionFieldProps<T>) {
  const invalid = error !== undefined;

  return (
    <Field data-invalid={invalid}>
      <FieldTitle id={groupTitleId(field)}>{title}</FieldTitle>
      <ToggleGroup
        id={controlId(field)}
        aria-labelledby={groupTitleId(field)}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId(field) : undefined}
        className="flex-wrap"
        value={value === "" ? [] : [value]}
        onValueChange={(next) => onChange(pickOption(options, next[0]))}
      >
        {options.map((option) => (
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
      <FieldError id={errorId(field)}>{error}</FieldError>
    </Field>
  );
}

"use client";

import * as React from "react";

import { Checkbox } from "../../../components/ui/checkbox";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "../../../components/ui/field";
import { Input } from "../../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";

/**
 * Visual-only /vacantes preferences. They hold local view state only: no
 * `name`, no query key, no router call and no result count, so they never
 * reach the functional filter `FormData` or the canonical URL. The desktop
 * sidebar and the mobile Sheet render the same controlled component against
 * one shared state, distinguished by `idPrefix`.
 */
export type JobsWorkLanguage = "spanish" | "english" | "both";

export type JobsBenefitKey =
  | "medical_insurance"
  | "flexible_schedule"
  | "training";

export type JobsVisualPreferencesValue = {
  monthlyMin: string;
  monthlyMax: string;
  language: JobsWorkLanguage | null;
  benefits: Record<JobsBenefitKey, boolean>;
};

export const EMPTY_JOBS_VISUAL_PREFERENCES: JobsVisualPreferencesValue = {
  monthlyMin: "",
  monthlyMax: "",
  language: null,
  benefits: {
    medical_insurance: false,
    flexible_schedule: false,
    training: false,
  },
};

const LANGUAGE_ITEMS = [
  { value: null, label: "Sin preferencia" },
  { value: "spanish", label: "Español" },
  { value: "english", label: "Inglés" },
  { value: "both", label: "Ambos" },
] satisfies ReadonlyArray<{ value: JobsWorkLanguage | null; label: string }>;

const BENEFITS = [
  { key: "medical_insurance", label: "Seguro médico" },
  { key: "flexible_schedule", label: "Horario flexible" },
  { key: "training", label: "Formación" },
] satisfies ReadonlyArray<{ key: JobsBenefitKey; label: string }>;

export function JobsVisualPreferences({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: JobsVisualPreferencesValue;
  onChange: (next: JobsVisualPreferencesValue) => void;
}) {
  return (
    <FieldSet
      data-jobs-visual-preferences
      className="gap-4 rounded-2xl border border-border bg-card/60 p-5"
    >
      <FieldLegend variant="label" className="mb-0">
        Preferencias
      </FieldLegend>
      <FieldGroup className="gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor={`${idPrefix}pref-monthly-min`}>
              Sueldo mínimo mensual
            </FieldLabel>
            <Input
              id={`${idPrefix}pref-monthly-min`}
              type="number"
              inputMode="numeric"
              min={0}
              value={value.monthlyMin}
              placeholder="MXN"
              onChange={(event) =>
                onChange({ ...value, monthlyMin: event.target.value })
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${idPrefix}pref-monthly-max`}>
              Sueldo máximo mensual
            </FieldLabel>
            <Input
              id={`${idPrefix}pref-monthly-max`}
              type="number"
              inputMode="numeric"
              min={0}
              value={value.monthlyMax}
              placeholder="MXN"
              onChange={(event) =>
                onChange({ ...value, monthlyMax: event.target.value })
              }
            />
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor={`${idPrefix}pref-language`}>
            Idioma de trabajo
          </FieldLabel>
          <Select
            value={value.language}
            items={LANGUAGE_ITEMS}
            onValueChange={(next) => onChange({ ...value, language: next })}
          >
            <SelectTrigger id={`${idPrefix}pref-language`} className="w-full">
              <SelectValue placeholder="Sin preferencia" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {LANGUAGE_ITEMS.map((item) => (
                  <SelectItem key={item.label} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <FieldSet className="gap-2.5">
          <FieldLegend variant="label" className="mb-0">
            Beneficios
          </FieldLegend>
          {BENEFITS.map((benefit) => (
            <Field key={benefit.key} orientation="horizontal">
              <Checkbox
                id={`${idPrefix}pref-benefit-${benefit.key}`}
                checked={value.benefits[benefit.key]}
                onCheckedChange={(checked) =>
                  onChange({
                    ...value,
                    benefits: { ...value.benefits, [benefit.key]: checked },
                  })
                }
              />
              <FieldLabel
                htmlFor={`${idPrefix}pref-benefit-${benefit.key}`}
                className="font-normal"
              >
                {benefit.label}
              </FieldLabel>
            </Field>
          ))}
        </FieldSet>
      </FieldGroup>
    </FieldSet>
  );
}

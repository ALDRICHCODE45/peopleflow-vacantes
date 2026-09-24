"use client";

import * as React from "react";

import { DraftRail } from "./form/draft-rail";
import {
  INITIAL_VALUES,
  attemptDraftSave,
  controlId,
  firstInvalidField,
} from "./form/model";
import type {
  VacancyField,
  VacancyFieldErrors,
  VacancyFormValues,
} from "./form/model";
import { INITIAL_PROTOTYPE_VALUES } from "./form/prototype-model";
import type { VacancyPrototypeValues } from "./form/prototype-model";
import { toPlainText } from "./form/rich-text-model";
import { VacancyFormSections } from "./form/vacancy-form-sections";

/**
 * Employer create-vacancy form body.
 *
 * It owns exactly three states: the contract values that the save attempt
 * validates, the local-only complementary values that exist for visual
 * exploration, and the field errors of the last attempt. The section tree lives
 * behind `form/vacancy-form-sections.tsx`, the form model owns normalization and
 * schema-backed validation, and the draft rail owns the preview and the save
 * affordance.
 *
 * The tokenized rich description is local-only state: the contract description
 * is always its derived plain text, so a formatting marker can never reach the
 * wire value. The save affordance stays visibly inert: the model is the only
 * validation boundary, a valid attempt produces no visible change and issues no
 * request, and field errors clear only once the corrected values become valid.
 */
export function CreateVacancyForm() {
  const [values, setValues] =
    React.useState<VacancyFormValues>(INITIAL_VALUES);
  const [prototypeValues, setPrototypeValues] =
    React.useState<VacancyPrototypeValues>(INITIAL_PROTOTYPE_VALUES);
  const [errors, setErrors] = React.useState<VacancyFieldErrors>({});
  const formRef = React.useRef<HTMLFormElement | null>(null);

  function update<K extends keyof VacancyFormValues>(
    key: K,
    value: VacancyFormValues[K],
  ) {
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  /** Prototype edits re-derive the contract description as plain text. */
  function updatePrototype(next: VacancyPrototypeValues) {
    setPrototypeValues(next);
    update("description", toPlainText(next.descriptionRich));
  }

  /** Focuses the real control behind one field, composite controls included. */
  function focusField(field: VacancyField) {
    const control = formRef.current?.querySelector<HTMLElement>(
      `#${controlId(field)}`,
    );
    if (control === null || control === undefined) return;
    const target = control.matches("input, textarea, button")
      ? control
      : control.querySelector<HTMLElement>("input, textarea, button");
    (target ?? control).focus();
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // The model validates the contract values alone: a valid draft has nothing
    // to persist, while an invalid one reports its field errors.
    const nextErrors = attemptDraftSave(values);
    setErrors(nextErrors);

    // Focus answers an invalid submit only; editing never moves the caret.
    const invalid = firstInvalidField(nextErrors);
    if (invalid !== null) focusField(invalid);
  }

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={handleSubmit}
      className="flex flex-col gap-6"
    >
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <VacancyFormSections
          values={values}
          errors={errors}
          onChange={update}
          prototypeValues={prototypeValues}
          onChangePrototype={updatePrototype}
        />

        <DraftRail values={values} prototypeValues={prototypeValues} />
      </div>
    </form>
  );
}

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
 * It owns exactly two states: the contract values that the save attempt reads,
 * and the local-only prototype values that exist for visual exploration. The
 * section tree lives behind `form/vacancy-form-sections.tsx`, the form model owns
 * normalization and schema-backed validation, and the draft rail owns the
 * preview and the save affordance.
 *
 * The tokenized rich description is prototype state: the contract description is
 * always its derived plain text, so a formatting marker can never reach the wire
 * value. Saving stays deliberately fail-closed: without recruiter authentication
 * there is nothing to authorize a write with, so a valid attempt explains the
 * blocker and sends nothing. Prototype state never reaches that decision.
 */
export function CreateVacancyForm() {
  const [values, setValues] =
    React.useState<VacancyFormValues>(INITIAL_VALUES);
  const [prototypeValues, setPrototypeValues] =
    React.useState<VacancyPrototypeValues>(INITIAL_PROTOTYPE_VALUES);
  const [errors, setErrors] = React.useState<VacancyFieldErrors>({});
  const [notice, setNotice] = React.useState<string | null>(null);
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

    // The model decides the attempt's outcome from the contract values alone.
    const attempt = attemptDraftSave(values);
    setErrors(attempt.errors);
    setNotice(attempt.notice);

    // Focus answers an invalid submit only; editing never moves the caret.
    const invalid = firstInvalidField(attempt.errors);
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

        <DraftRail
          values={values}
          prototypeValues={prototypeValues}
          notice={notice}
        />
      </div>
    </form>
  );
}

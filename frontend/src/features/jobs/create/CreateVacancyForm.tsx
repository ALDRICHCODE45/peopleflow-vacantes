"use client";

import * as React from "react";

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
import type { ReviewStepId } from "./form/review-step";
import { toPlainText } from "./form/rich-text-model";
import {
  firstInvalidStep,
  nextStep,
  previousStep,
  stepFieldErrors,
} from "./form/step-model";
import type { VacancyStepId } from "./form/step-model";
import { StepProgress } from "./form/step-progress";
import { VacancyFormSections } from "./form/vacancy-form-sections";
import { WizardControls } from "./form/wizard-controls";

/**
 * Employer create-vacancy form body: the four-step wizard owner.
 *
 * It owns four states: the contract values the schema validates, the local-only
 * complementary values, the field errors of the last attempt, and the current
 * step. Every navigation action keeps both value states and the error record, so
 * Back and Continue never lose what the recruiter typed. Only the current step's
 * fields render.
 *
 * Continue validates the current step against the exact schema authority; an
 * invalid step stays in place and focuses its first offending control. The final
 * save is validation-only: a valid draft produces no visible change and issues no
 * request, while an invalid one routes to the first invalid step and focuses its
 * first invalid control after mount.
 */
export function CreateVacancyForm() {
  const [values, setValues] =
    React.useState<VacancyFormValues>(INITIAL_VALUES);
  const [prototypeValues, setPrototypeValues] =
    React.useState<VacancyPrototypeValues>(INITIAL_PROTOTYPE_VALUES);
  const [errors, setErrors] = React.useState<VacancyFieldErrors>({});
  const [step, setStep] = React.useState<VacancyStepId>("basic-information");

  const formRef = React.useRef<HTMLFormElement | null>(null);
  const stepRegionRef = React.useRef<HTMLDivElement | null>(null);
  /** Field to focus after the next commit, or null when a heading takes focus. */
  const pendingFieldRef = React.useRef<VacancyField | null>(null);
  /** Whether the next commit should move focus to the step heading. */
  const pendingHeadingRef = React.useRef(false);

  /**
   * Post-commit focus: a blocked step focuses its first invalid control, a plain
   * step change focuses the new step heading instead. Navigation is the only
   * source of either, so editing never moves the caret.
   */
  React.useEffect(() => {
    const field = pendingFieldRef.current;
    if (field !== null) {
      pendingFieldRef.current = null;
      pendingHeadingRef.current = false;
      const control = formRef.current?.querySelector<HTMLElement>(
        `#${controlId(field)}`,
      );
      if (control !== null && control !== undefined) {
        const target = control.matches("input, textarea, button")
          ? control
          : control.querySelector<HTMLElement>("input, textarea, button");
        (target ?? control).focus();
      }
      return;
    }
    if (!pendingHeadingRef.current) return;
    pendingHeadingRef.current = false;
    stepRegionRef.current?.querySelector<HTMLElement>("h2")?.focus();
  }, [step, errors]);

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

  /** Advances only when the current step owns no schema error. */
  function handleContinue() {
    const nextErrors = attemptDraftSave(values);
    setErrors(nextErrors);
    const invalid = firstInvalidField(stepFieldErrors(step, nextErrors));
    if (invalid !== null) {
      pendingFieldRef.current = invalid;
      return;
    }
    const following = nextStep(step);
    if (following === null) return;
    pendingHeadingRef.current = true;
    setStep(following);
  }

  function handleBack() {
    const previous = previousStep(step);
    if (previous === null) return;
    pendingHeadingRef.current = true;
    setStep(previous);
  }

  /** Review-only: returns to the step that owns the group being edited. */
  function handleEditStep(target: ReviewStepId) {
    pendingHeadingRef.current = true;
    setStep(target);
  }

  /** Final validation-only save: routes to the first invalid step, or is inert. */
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = attemptDraftSave(values);
    setErrors(nextErrors);

    const target = firstInvalidStep(nextErrors);
    if (target === null) return;
    pendingFieldRef.current = firstInvalidField(stepFieldErrors(target, nextErrors));
    setStep(target);
  }

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={handleSubmit}
      className="flex flex-col gap-6"
    >
      <StepProgress step={step} />

      <div ref={stepRegionRef} data-pf-step-region={step}>
        <VacancyFormSections
          step={step}
          values={values}
          errors={errors}
          onChange={update}
          prototypeValues={prototypeValues}
          onChangePrototype={updatePrototype}
          onEditStep={handleEditStep}
        />
      </div>

      <WizardControls
        step={step}
        onBack={handleBack}
        onContinue={handleContinue}
      />
    </form>
  );
}

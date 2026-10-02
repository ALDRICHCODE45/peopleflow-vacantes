"use client";

import * as React from "react";

import { useEmployerSession } from "@/features/company-site-editor/employer-session";
import {
  attemptDraftSave,
  controlId,
  firstInvalidField,
} from "./form/model";
import type {
  VacancyField,
  VacancyFieldErrors,
  VacancyFormValues,
} from "./form/model";
import type { VacancyPrototypeValues } from "./form/prototype-model";
import type { ReviewStepId } from "./form/review-step";
import { toPlainText } from "./form/rich-text-model";
import {
  firstInvalidStep,
  nextStep,
  previousStep,
  stepFieldErrors,
} from "./form/step-model";
import { StepProgress } from "./form/step-progress";
import { VacancyFormSections } from "./form/vacancy-form-sections";
import { WizardControls } from "./form/wizard-controls";

/**
 * Employer create-vacancy form body: the four-step wizard owner.
 *
 * It reads the wizard's durable state from the shared employer session — the
 * contract values, the local-only complementary values and the current step — so
 * a route round trip keeps the draft. Only the field errors of the last attempt
 * and the local publication outcome stay in the mounted surface.
 *
 * Continue validates the current step against the exact schema authority; an
 * invalid step stays in place and focuses its first offending control. Saving a
 * draft is validation-only and independent from the company profile, while
 * publishing runs the same validation and then the profile gate, so the vacancy
 * is published only when it is valid and the profile is ready.
 */
export function CreateVacancyForm() {
  const {
    vacancyValues: values,
    setVacancyValues: setValues,
    prototypeValues,
    setPrototypeValues,
    vacancyStep: step,
    setVacancyStep: setStep,
    profileReady,
  } = useEmployerSession();
  const [errors, setErrors] = React.useState<VacancyFieldErrors>({});
  const [published, setPublished] = React.useState(false);

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
    // An edit makes any shown publication outcome stale.
    setPublished(false);
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

  /**
   * Publication attempt: the same contract validation runs first, routing an
   * incomplete vacancy to its first invalid step. A valid vacancy publishes in
   * this session only when the company profile is already ready; the rail keeps
   * the action disabled otherwise, so the gate can never be bypassed here.
   */
  function handlePublish() {
    const nextErrors = attemptDraftSave(values);
    setErrors(nextErrors);

    const target = firstInvalidStep(nextErrors);
    if (target !== null) {
      pendingFieldRef.current = firstInvalidField(
        stepFieldErrors(target, nextErrors),
      );
      setStep(target);
      setPublished(false);
      return;
    }
    setPublished(profileReady);
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
          profileReady={profileReady}
          published={published}
          onPublish={handlePublish}
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

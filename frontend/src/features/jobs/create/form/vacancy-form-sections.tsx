import {
  ClipboardListIcon,
  FileTextIcon,
  WalletIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { BasicInformationSection } from "./basic-information-section";
import { BenefitsSection } from "./benefits-section";
import { CompensationSection } from "./compensation-section";
import { FormSectionCard } from "./form-section-card";
import { RequirementsSection } from "./requirements-section";
import { ReviewStep } from "./review-step";
import type { ReviewStepId } from "./review-step";
import { ScreeningSection } from "./screening-section";
import {
  ClosingDateField,
  LanguagesField,
  SkillsField,
} from "./strategy-section";
import {
  stepAnchorId,
  stepFieldErrors,
  stepTitle,
} from "./step-model";
import type { VacancyStepId } from "./step-model";
import type { VacancyFieldErrors, VacancyFormValues } from "./model";
import type { VacancyPrototypeValues } from "./prototype-model";

/**
 * Step boundary of the create-vacancy wizard.
 *
 * It renders exactly one step at a time: the step shell (one card, one real
 * heading) plus the field groups that belong to that step. Two independent
 * states feed it — the contract values with their error slots, and the local-only
 * prototype values — and nothing here can turn a prototype value into a request.
 *
 * The step switch is the only place that decides which fields a step shows; the
 * field-to-step partition lives in `step-model.ts`.
 */

/** Decorative step medallion; the step heading alone names the step. */
const STEP_ICONS: Record<ReviewStepId, LucideIcon> = {
  "basic-information": FileTextIcon,
  "role-profile": ClipboardListIcon,
  "conditions-process": WalletIcon,
};

export type VacancyFormSectionsProps = {
  /** The step currently shown; only its fields render. */
  step: VacancyStepId;
  /** Contract state, exactly as the save attempt will read it. */
  values: VacancyFormValues;
  /** Full error record; each step reads only the slots it owns. */
  errors: VacancyFieldErrors;
  onChange: <K extends keyof VacancyFormValues>(
    key: K,
    value: VacancyFormValues[K],
  ) => void;
  /** Caller-owned local-only prototype state. */
  prototypeValues: VacancyPrototypeValues;
  onChangePrototype: (next: VacancyPrototypeValues) => void;
  /** Review-only: returns to the step that owns the group being edited. */
  onEditStep: (step: ReviewStepId) => void;
};

export function VacancyFormSections({
  step,
  values,
  errors,
  onChange,
  prototypeValues,
  onChangePrototype,
  onEditStep,
}: VacancyFormSectionsProps) {
  if (step === "review") {
    return (
      <ReviewStep
        values={values}
        prototypeValues={prototypeValues}
        onEditStep={onEditStep}
      />
    );
  }

  // Each step reads only its own error slots, so an invalid field of another
  // step can never mark this one.
  const scoped = stepFieldErrors(step, errors);

  return (
    <FormSectionCard
      id={stepAnchorId(step)}
      icon={STEP_ICONS[step]}
      title={stepTitle(step)}
    >
      {step === "basic-information" && (
        <BasicInformationSection
          title={values.title}
          location={values.location}
          workMode={values.workMode}
          employmentType={values.employmentType}
          seniority={values.seniority}
          department={prototypeValues.department}
          errors={scoped}
          onChangeTitle={(value) => onChange("title", value)}
          onChangeLocation={(value) => onChange("location", value)}
          onChangeWorkMode={(value) => onChange("workMode", value)}
          onChangeEmploymentType={(value) => onChange("employmentType", value)}
          onChangeSeniority={(value) => onChange("seniority", value)}
          onChangeDepartment={(value) =>
            onChangePrototype({ ...prototypeValues, department: value })
          }
        />
      )}

      {step === "role-profile" && (
        <div className="flex flex-col gap-6">
          <RequirementsSection
            descriptionRich={prototypeValues.descriptionRich}
            requiredRequirements={prototypeValues.requiredRequirements}
            preferredRequirements={prototypeValues.preferredRequirements}
            descriptionError={scoped.description}
            onChangeDescriptionRich={(value) =>
              onChangePrototype({ ...prototypeValues, descriptionRich: value })
            }
            onChangeRequiredRequirements={(value) =>
              onChangePrototype({ ...prototypeValues, requiredRequirements: value })
            }
            onChangePreferredRequirements={(value) =>
              onChangePrototype({ ...prototypeValues, preferredRequirements: value })
            }
          />
          <SkillsField values={prototypeValues} onChange={onChangePrototype} />
          <LanguagesField values={prototypeValues} onChange={onChangePrototype} />
        </div>
      )}

      {step === "conditions-process" && (
        <div className="flex flex-col gap-6">
          <CompensationSection
            salaryCurrency={values.salaryCurrency}
            salaryMin={values.salaryMin}
            salaryMax={values.salaryMax}
            errors={scoped}
            onChangeSalaryCurrency={(value) => onChange("salaryCurrency", value)}
            onChangeSalaryMin={(value) => onChange("salaryMin", value)}
            onChangeSalaryMax={(value) => onChange("salaryMax", value)}
          />
          <BenefitsSection values={prototypeValues} onChange={onChangePrototype} />
          <ClosingDateField values={prototypeValues} onChange={onChangePrototype} />
          <ScreeningSection values={prototypeValues} onChange={onChangePrototype} />
        </div>
      )}
    </FormSectionCard>
  );
}

import { BasicInformationSection } from "./basic-information-section";
import { BenefitsSection } from "./benefits-section";
import { CompensationSection } from "./compensation-section";
import { RequirementsSection } from "./requirements-section";
import { ScreeningSection } from "./screening-section";
import { SectionNavigator } from "./section-navigator";
import { StrategySection } from "./strategy-section";
import type { VacancyFieldErrors, VacancyFormValues } from "./model";
import type { VacancyPrototypeValues } from "./prototype-model";

/**
 * Section boundary of the create-vacancy screen.
 *
 * It maps two independent states onto the verified section components: the
 * contract values and their error slots drive every POST /jobs field, while the
 * prototype values drive the local-only exploratory fields. Nothing here parses
 * the wire contract, and nothing here can turn prototype state into a request.
 *
 * The section navigator sits above this grid.
 *
 * Layout: one column by default, two at `xl`, with the taller requirements and
 * screening cards spanning both columns. Rows are top-aligned (`items-start`) so
 * every card keeps its natural content height instead of stretching to match a
 * taller neighbour.
 */

export type VacancyFormSectionsProps = {
  /** Contract state, exactly as the save attempt will read it. */
  values: VacancyFormValues;
  errors: VacancyFieldErrors;
  onChange: <K extends keyof VacancyFormValues>(
    key: K,
    value: VacancyFormValues[K],
  ) => void;
  /** Caller-owned local-only prototype state. */
  prototypeValues: VacancyPrototypeValues;
  onChangePrototype: (next: VacancyPrototypeValues) => void;
};

export function VacancyFormSections({
  values,
  errors,
  onChange,
  prototypeValues,
  onChangePrototype,
}: VacancyFormSectionsProps) {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <SectionNavigator />

      <div
        data-pf-form-sections=""
        className="grid min-w-0 items-start gap-5 xl:grid-cols-2"
      >
      <BasicInformationSection
        title={values.title}
        location={values.location}
        workMode={values.workMode}
        employmentType={values.employmentType}
        seniority={values.seniority}
        errors={errors}
        onChangeTitle={(value) => onChange("title", value)}
        onChangeLocation={(value) => onChange("location", value)}
        onChangeWorkMode={(value) => onChange("workMode", value)}
        onChangeEmploymentType={(value) => onChange("employmentType", value)}
        onChangeSeniority={(value) => onChange("seniority", value)}
      />

      <CompensationSection
        salaryCurrency={values.salaryCurrency}
        salaryMin={values.salaryMin}
        salaryMax={values.salaryMax}
        errors={errors}
        onChangeSalaryCurrency={(value) => onChange("salaryCurrency", value)}
        onChangeSalaryMin={(value) => onChange("salaryMin", value)}
        onChangeSalaryMax={(value) => onChange("salaryMax", value)}
      />

      <div className="min-w-0 xl:col-span-2">
        <RequirementsSection
          descriptionRich={prototypeValues.descriptionRich}
          requiredRequirements={prototypeValues.requiredRequirements}
          preferredRequirements={prototypeValues.preferredRequirements}
          descriptionError={errors.description}
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
      </div>

      <StrategySection values={prototypeValues} onChange={onChangePrototype} />
      <BenefitsSection values={prototypeValues} onChange={onChangePrototype} />

      <div className="min-w-0 xl:col-span-2">
        <ScreeningSection values={prototypeValues} onChange={onChangePrototype} />
      </div>
      </div>
    </div>
  );
}

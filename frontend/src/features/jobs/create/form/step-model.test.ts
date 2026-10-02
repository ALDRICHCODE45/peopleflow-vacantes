import { describe, expect, it } from "vitest";

import { INITIAL_VALUES, VACANCY_FIELDS } from "./model";
import type { VacancyField, VacancyFieldErrors } from "./model";
import {
  STEP_FIELDS,
  VACANCY_STEP_IDS,
  VACANCY_STEPS,
  fieldsForStep,
  firstInvalidStep,
  nextStep,
  previousStep,
  stepFieldErrors,
  stepHasErrors,
  stepIndex,
  stepNumber,
  stepOfField,
  stepTitle,
  stepAnchorId,
  validateStepDraft,
} from "@/features/jobs/create/form/step-model";
import type { VacancyStepId, VacancyStepMetadata } from "@/features/jobs/create/form/step-model";

/** A draft the base schema accepts, used to isolate the cross-field rules. */
const VALID_VALUES = {
  ...INITIAL_VALUES,
  title: "Backend Developer",
  description: "Diseñá los servicios core.",
  workMode: "remote" as const,
  employmentType: "full_time" as const,
  seniority: "senior" as const,
};

/**
 * Pure contract of the four-step wizard: step order, the step-to-field
 * partition, the scoped error projection, and the deterministic first invalid
 * step. The schema authority stays in `model.ts`; this module only reads it.
 */

describe("vacancy step model order and titles", () => {
  it("declares the four canonical steps once, in order", () => {
    expect(VACANCY_STEP_IDS).toEqual([
      "basic-information",
      "role-profile",
      "conditions-process",
      "review",
    ]);
    expect(new Set(VACANCY_STEP_IDS).size).toBe(VACANCY_STEP_IDS.length);
    expect(VACANCY_STEPS).toHaveLength(4);
    expect(VACANCY_STEPS.map((step: VacancyStepMetadata) => step.id)).toEqual([
      ...VACANCY_STEP_IDS,
    ]);
  });

  it("names each step in Spanish and numbers them from one", () => {
    expect(stepTitle("basic-information")).toBe("Información básica");
    expect(stepTitle("role-profile")).toBe("Perfil del puesto");
    expect(stepTitle("conditions-process")).toBe("Condiciones y proceso");
    expect(stepTitle("review")).toBe("Revisar");
    expect(
      VACANCY_STEPS.every(
        (step: VacancyStepMetadata) => step.title.trim() !== "",
      ),
    ).toBe(true);

    expect(VACANCY_STEP_IDS.map(stepNumber)).toEqual([1, 2, 3, 4]);
    expect(VACANCY_STEP_IDS.map(stepIndex)).toEqual([0, 1, 2, 3]);
    expect(stepAnchorId("review")).toBe("vacancy-step-review");
  });
});

describe("vacancy step field mapping", () => {
  it("partitions every contract field into exactly one non-review step", () => {
    const owned = VACANCY_STEP_IDS.flatMap((step: VacancyStepId) => [
      ...STEP_FIELDS[step],
    ]);
    // Every contract field appears exactly once, in canonical order overall.
    expect(new Set(owned).size).toBe(owned.length);
    expect([...owned].sort()).toEqual([...VACANCY_FIELDS].sort());

    for (const field of VACANCY_FIELDS) {
      expect(VACANCY_STEP_IDS).toContain(stepOfField(field));
    }
  });

  it("assigns the documented fields to each step", () => {
    expect(fieldsForStep("basic-information")).toEqual([
      "title",
      "work_mode",
      "employment_type",
      "seniority",
      "location",
    ]);
    expect(fieldsForStep("role-profile")).toEqual(["description"]);
    expect(fieldsForStep("conditions-process")).toEqual([
      "salary_min",
      "salary_max",
      "salary_currency",
    ]);
    // Review owns no contract field: it only summarizes and saves.
    expect(fieldsForStep("review")).toEqual([]);
  });

  it("maps a field back to the step that owns it", () => {
    expect(stepOfField("title")).toBe("basic-information");
    expect(stepOfField("description")).toBe("role-profile");
    expect(stepOfField("salary_max")).toBe("conditions-process");
  });
});

describe("vacancy step scoped errors", () => {
  const errors: VacancyFieldErrors = {
    title: "t",
    description: "d",
    salary_max: "s",
  };

  it("projects only the errors the step owns, in canonical field order", () => {
    expect(stepFieldErrors("basic-information", errors)).toEqual({ title: "t" });
    expect(stepFieldErrors("role-profile", errors)).toEqual({
      description: "d",
    });
    expect(stepFieldErrors("conditions-process", errors)).toEqual({
      salary_max: "s",
    });
    expect(stepFieldErrors("review", errors)).toEqual({});
    expect(stepFieldErrors("basic-information", {})).toEqual({});
  });

  it("reports whether a step carries any error", () => {
    expect(stepHasErrors("basic-information", errors)).toBe(true);
    expect(stepHasErrors("conditions-process", errors)).toBe(true);
    expect(stepHasErrors("review", errors)).toBe(false);
    expect(stepHasErrors("role-profile", {})).toBe(false);
  });
});

describe("first invalid step", () => {
  it("returns null when nothing failed", () => {
    expect(firstInvalidStep({})).toBeNull();
  });

  it("returns the earliest step in wizard order that owns an error", () => {
    expect(firstInvalidStep({ description: "d" })).toBe("role-profile");
    expect(firstInvalidStep({ salary_min: "s" })).toBe("conditions-process");
    // A later step can never outrank an earlier one.
    expect(
      firstInvalidStep({ salary_max: "s", description: "d", title: "t" }),
    ).toBe("basic-information");
    // Canonical field order inside one step still resolves to that step.
    expect(firstInvalidStep({ seniority: "s", title: "t" })).toBe(
      "basic-information",
    );
  });
});

describe("step navigation helpers", () => {
  it("returns the next step until review, then null", () => {
    expect(nextStep("basic-information")).toBe("role-profile");
    expect(nextStep("role-profile")).toBe("conditions-process");
    expect(nextStep("conditions-process")).toBe("review");
    expect(nextStep("review")).toBeNull();
  });

  it("returns the previous step until the first, then null", () => {
    expect(previousStep("review")).toBe("conditions-process");
    expect(previousStep("conditions-process")).toBe("role-profile");
    expect(previousStep("role-profile")).toBe("basic-information");
    expect(previousStep("basic-information")).toBeNull();
  });
});

describe("validateStepDraft", () => {
  it("scopes the real schema errors to the step that owns them", () => {
    // The shared schema still rejects description and salary, but step one only
    // reports the fields it owns: title plus the three required enums.
    expect(validateStepDraft("basic-information", INITIAL_VALUES)).toEqual({
      title: "Ingresa un título para la vacante.",
      work_mode: "Elige una modalidad de trabajo.",
      employment_type: "Elige una jornada de trabajo.",
      seniority: "Elige un seniority para la vacante.",
    });
    // Location is optional, so a blank location never fails step one.
    expect(
      validateStepDraft("basic-information", {
        ...INITIAL_VALUES,
        title: "Backend Developer",
        workMode: "remote",
        employmentType: "full_time",
        seniority: "senior",
      }),
    ).toEqual({});
  });

  it("validates the role profile and conditions steps from the same schema", () => {
    expect(validateStepDraft("role-profile", INITIAL_VALUES)).toEqual({
      description: "Ingresa una descripción para la vacante.",
    });
    // The cross-field range rule belongs to the shared schema, so it only runs
    // once the other contract fields are valid; the step still owns its report.
    expect(
      validateStepDraft("conditions-process", {
        ...VALID_VALUES,
        salaryMin: "40000",
        salaryMax: "25000",
      }),
    ).toEqual({
      salary_max: "El salario máximo debe ser mayor o igual al salario mínimo.",
    });
    expect(
      validateStepDraft("conditions-process", { ...INITIAL_VALUES }),
    ).toEqual({});
    expect(validateStepDraft("review", INITIAL_VALUES)).toEqual({});
  });

  it("never returns a field outside the step it was asked about", () => {
    const owned = new Set<VacancyField>(fieldsForStep("basic-information"));
    for (const field of Object.keys(
      validateStepDraft("basic-information", INITIAL_VALUES),
    )) {
      expect(owned.has(field as VacancyField)).toBe(true);
    }
  });
});

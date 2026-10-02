"use client";

import * as React from "react";

import { INITIAL_VALUES } from "@/features/jobs/create/form/model";
import type { VacancyFormValues } from "@/features/jobs/create/form/model";
import { INITIAL_PROTOTYPE_VALUES } from "@/features/jobs/create/form/prototype-model";
import type { VacancyPrototypeValues } from "@/features/jobs/create/form/prototype-model";
import { VACANCY_STEP_IDS } from "@/features/jobs/create/form/step-model";
import type { VacancyStepId } from "@/features/jobs/create/form/step-model";
import {
  confirmEmployerSiteName,
  createEmployerSiteProfileState,
  isEmployerSiteProfileReady,
  updateEmployerSiteProfileField,
} from "./employer-site-draft";
import type {
  EmployerSiteField,
  EmployerSiteProfileState,
} from "./employer-site-draft";

/**
 * Shared client session of the employer route group.
 *
 * The `(empresa)` layout mounts one provider above every employer route, so the
 * state here outlives the consumers below it: navigating to the company site and
 * back remounts the route content but never the layout, and the draft the
 * recruiter was writing is still there.
 *
 * It keeps exactly the work in progress CPP-1 needs: the local company draft
 * (with its explicit name confirmation and the trimmed publication gate) and the
 * create-vacancy state the wizard owns today — the contract values, the
 * local-only complementary values and the current step. It performs no request,
 * no storage and no navigation, and it never authors a public profile.
 */
export type EmployerSession = {
  /** Local company draft plus the explicit confirmation of its name. */
  readonly profile: EmployerSiteProfileState;
  /** Whether the minimum company profile allows publishing a vacancy. */
  readonly profileReady: boolean;
  /** Immutable company field update; editing the name revokes confirmation. */
  updateCompanyField: (field: EmployerSiteField, value: string) => void;
  /** Explicitly confirms the currently declared company name. */
  confirmCompanyName: () => void;
  /** Contract values the create-vacancy wizard validates. */
  readonly vacancyValues: VacancyFormValues;
  setVacancyValues: React.Dispatch<React.SetStateAction<VacancyFormValues>>;
  /** Local-only complementary values the wizard keeps beside the contract. */
  readonly prototypeValues: VacancyPrototypeValues;
  setPrototypeValues: React.Dispatch<React.SetStateAction<VacancyPrototypeValues>>;
  /** Current wizard step, kept so a route round trip returns to it. */
  readonly vacancyStep: VacancyStepId;
  setVacancyStep: React.Dispatch<React.SetStateAction<VacancyStepId>>;
};

const EmployerSessionContext = React.createContext<EmployerSession | null>(null);

export function EmployerSessionProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [profile, setProfile] = React.useState(createEmployerSiteProfileState);
  const [vacancyValues, setVacancyValues] =
    React.useState<VacancyFormValues>(INITIAL_VALUES);
  const [prototypeValues, setPrototypeValues] =
    React.useState<VacancyPrototypeValues>(INITIAL_PROTOTYPE_VALUES);
  const [vacancyStep, setVacancyStep] = React.useState<VacancyStepId>(
    VACANCY_STEP_IDS[0],
  );

  const updateCompanyField = React.useCallback(
    (field: EmployerSiteField, value: string) => {
      setProfile((current) =>
        updateEmployerSiteProfileField(current, field, value),
      );
    },
    [],
  );

  const confirmCompanyName = React.useCallback(() => {
    setProfile((current) => confirmEmployerSiteName(current));
  }, []);

  const value = React.useMemo<EmployerSession>(
    () => ({
      profile,
      profileReady: isEmployerSiteProfileReady(profile),
      updateCompanyField,
      confirmCompanyName,
      vacancyValues,
      setVacancyValues,
      prototypeValues,
      setPrototypeValues,
      vacancyStep,
      setVacancyStep,
    }),
    [
      profile,
      updateCompanyField,
      confirmCompanyName,
      vacancyValues,
      prototypeValues,
      vacancyStep,
    ],
  );

  return (
    <EmployerSessionContext.Provider value={value}>
      {children}
    </EmployerSessionContext.Provider>
  );
}

/** The employer session; throws when a consumer sits outside the layout provider. */
export function useEmployerSession(): EmployerSession {
  const session = React.useContext(EmployerSessionContext);
  if (session === null) {
    throw new Error(
      "useEmployerSession must be used inside EmployerSessionProvider",
    );
  }
  return session;
}

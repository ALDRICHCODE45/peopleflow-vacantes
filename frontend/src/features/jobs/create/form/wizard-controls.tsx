import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { nextStep, previousStep } from "./step-model";
import type { VacancyStepId } from "./step-model";

/**
 * Shared navigation row of the four-step wizard: one Back control and, on every
 * step before review, one Continue control. It owns no state and never saves:
 * Continue delegates validation to the wizard owner, and the save affordance
 * lives only in the review rail.
 */
export type WizardControlsProps = {
  step: VacancyStepId;
  onBack: () => void;
  onContinue: () => void;
};

export function WizardControls({ step, onBack, onContinue }: WizardControlsProps) {
  const isFirst = previousStep(step) === null;
  const isLast = nextStep(step) === null;

  return (
    <div
      data-pf-wizard-controls=""
      className="flex items-center justify-between gap-3"
    >
      <Button
        type="button"
        variant="outline"
        className="h-10"
        onClick={onBack}
        disabled={isFirst}
      >
        <ArrowLeftIcon data-icon="inline-start" />
        Atrás
      </Button>

      {!isLast && (
        <Button type="button" className="h-10" onClick={onContinue}>
          Continuar
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      )}
    </div>
  );
}

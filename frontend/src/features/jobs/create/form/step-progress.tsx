import { cn } from "cn";

import { Progress, ProgressLabel } from "@/components/ui/progress";
import {
  STEP_COUNT,
  VACANCY_STEPS,
  stepNumber,
  stepTitle,
} from "./step-model";
import type { VacancyStepId } from "./step-model";

/**
 * Accessible progress of the four-step wizard.
 *
 * It counts steps, never data: the marker shows the step number behind a visible
 * Spanish label, and the current step is exposed with `aria-current="step"` plus
 * the `Progress` value. No step claims completeness, validity, or save readiness,
 * so nothing here can contradict the final validation.
 */

/** Token-only paint for one step marker: semantic colors only. */
const MARKER_BASE =
  "inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums";
const MARKER_STATE = {
  complete: "border-primary text-foreground",
  current: "border-primary bg-primary text-primary-foreground",
  upcoming: "border-border text-muted-foreground",
} as const;

type StepMarkerState = keyof typeof MARKER_STATE;

function markerStateOf(index: number, currentIndex: number): StepMarkerState {
  if (index < currentIndex) return "complete";
  if (index === currentIndex) return "current";
  return "upcoming";
}

export type StepProgressProps = {
  /** The step the wizard is currently showing. */
  step: VacancyStepId;
};

export function StepProgress({ step }: StepProgressProps) {
  const current = stepNumber(step);
  const label = `Paso ${current} de ${STEP_COUNT}`;

  return (
    <div data-pf-step-progress="" className="flex flex-col gap-3">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {VACANCY_STEPS.map((item, index) => (
          <li
            key={item.id}
            aria-current={item.id === step ? "step" : undefined}
            className="flex min-w-0 items-center gap-2"
          >
            <span
              aria-hidden="true"
              className={cn(
                MARKER_BASE,
                MARKER_STATE[markerStateOf(index, current - 1)],
              )}
            >
              {index + 1}
            </span>
            <span className="min-w-0 text-[11px] leading-tight font-medium text-foreground sm:text-xs">
              {item.title}
            </span>
          </li>
        ))}
      </ol>
      <Progress value={current} max={STEP_COUNT} aria-valuetext={label}>
        <ProgressLabel className="text-xs text-muted-foreground">
          {label} · {stepTitle(step)}
        </ProgressLabel>
      </Progress>
    </div>
  );
}

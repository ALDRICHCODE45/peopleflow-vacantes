import { CheckIcon, MinusIcon } from "lucide-react";
import { cn } from "cn";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { vacancyCompletion } from "./completion-model";
import type { VacancyFormValues } from "./model";
import type { VacancyPrototypeValues } from "./prototype-model";

export type CompletionSummaryProps = {
  /** Contract state, exactly as the save attempt reads it. */
  values: VacancyFormValues;
  /** Local-only exploratory state, exactly as the enriched sections read it. */
  prototypeValues: VacancyPrototypeValues;
};

/**
 * Observable progress of the vacancy draft: which sections already hold content,
 * recomputed on every render from the current state. No hook state, no effect,
 * no memo, nothing deferred, and no claim about validity, saving, persistence,
 * or remote sync.
 */
export function CompletionSummary({ values, prototypeValues }: CompletionSummaryProps) {
  const { sections, completed, total } = vacancyCompletion(values, prototypeValues);
  const count = `${completed} de ${total} secciones completas`;

  return (
    <Card size="sm" data-pf-completion-summary="">
      <CardHeader>
        <CardTitle><h2 className="font-heading text-base font-medium">Progreso de la vacante</h2></CardTitle>
        <CardDescription>Revisá qué secciones tienen contenido antes de guardar el borrador.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs font-medium">{count}</p>
        {/* The width is visual only: the value text is the visible count. */}
        <div role="progressbar" aria-label="Secciones de la vacante con contenido" aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed} aria-valuetext={count} className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div aria-hidden="true" className="h-full rounded-full bg-primary" style={{ width: `${(completed / total) * 100}%` }} />
        </div>
        <ul className="flex flex-col gap-1.5">
          {sections.map((section) => (
            <li key={section.id} data-pf-completion-item={section.id} className="flex items-center justify-between gap-3">
              <span className="truncate text-sm text-muted-foreground">{section.title}</span>
              <span className={cn("inline-flex shrink-0 items-center gap-1 text-xs font-medium", section.complete ? "text-primary" : "text-muted-foreground")}>
                {section.complete ? <CheckIcon aria-hidden="true" className="size-3.5" /> : <MinusIcon aria-hidden="true" className="size-3.5" />}
                {section.complete ? "Completa" : "Pendiente"}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

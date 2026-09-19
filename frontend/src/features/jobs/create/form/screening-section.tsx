import { ListChecksIcon, PlusIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { FormSectionCard } from "./form-section-card";
import {
  MAX_SCREENING_QUESTIONS,
  addScreeningQuestion,
  removeScreeningQuestion,
  updateScreeningQuestion,
} from "./prototype-model";
import type { VacancyPrototypeValues } from "./prototype-model";
import { sectionAnchorId, sectionTitle } from "./section-metadata";

/**
 * Local-only screening questions.
 *
 * Zero questions is a valid configuration and the surface says so instead of
 * rendering an empty box. Every add, update, and removal goes through the
 * immutable model helpers, so row identity stays stable for the caller.
 */

/**
 * Next unused local identifier for a new question. It depends only on the
 * current state, so no clock, random source, or global counter is involved.
 */
function nextQuestionId(used: readonly { id: string }[]): string {
  let index = 1;
  while (used.some((question) => question.id === `question-${index}`)) {
    index += 1;
  }
  return `question-${index}`;
}

export type ScreeningSectionProps = {
  /** Caller-owned local-only prototype state. */
  values: VacancyPrototypeValues;
  onChange: (next: VacancyPrototypeValues) => void;
};

export function ScreeningSection({ values, onChange }: ScreeningSectionProps) {
  const questions = values.screeningQuestions;
  const atLimit = questions.length >= MAX_SCREENING_QUESTIONS;

  function addQuestion() {
    const next = addScreeningQuestion(questions, {
      id: nextQuestionId(questions),
      prompt: "",
    });
    if (next !== questions) onChange({ ...values, screeningQuestions: next });
  }

  return (
    <FormSectionCard
      id={sectionAnchorId("screening")}
      icon={ListChecksIcon}
      title={sectionTitle("screening")}
    >
      <FieldGroup className="gap-4">
        <p className="text-sm text-muted-foreground">
          Son opcionales: podés publicar la vacante sin ninguna y agregar hasta{" "}
          {MAX_SCREENING_QUESTIONS}.
        </p>

        {questions.length === 0 ? (
          <Empty className="border border-border p-6">
            <EmptyHeader>
              <EmptyTitle>Sin preguntas de filtro</EmptyTitle>
              <EmptyDescription>
                Agregá una pregunta para filtrar las postulaciones que recibe la
                vacante.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-3">
            {questions.map((question, index) => (
              <div key={question.id} className="flex items-end gap-2">
                <Field>
                  <FieldLabel htmlFor={`${question.id}-prompt`}>
                    Pregunta {index + 1}
                  </FieldLabel>
                  <Input
                    id={`${question.id}-prompt`}
                    value={question.prompt}
                    onChange={(event) =>
                      onChange({
                        ...values,
                        screeningQuestions: updateScreeningQuestion(
                          questions,
                          question.id,
                          { prompt: event.target.value },
                        ),
                      })
                    }
                    placeholder="Ej.: ¿Cuántos años de experiencia tenés con React?"
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Quitar pregunta ${index + 1}`}
                  onClick={() =>
                    onChange({
                      ...values,
                      screeningQuestions: removeScreeningQuestion(
                        questions,
                        question.id,
                      ),
                    })
                  }
                >
                  <XIcon />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={atLimit}
            onClick={addQuestion}
          >
            <PlusIcon data-icon="inline-start" />
            Agregar pregunta
          </Button>
        </div>
      </FieldGroup>
    </FormSectionCard>
  );
}

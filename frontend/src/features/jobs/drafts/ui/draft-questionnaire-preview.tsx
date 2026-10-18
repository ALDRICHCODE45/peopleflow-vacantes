"use client";

import * as React from "react";
import { LockIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSkip,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire";

import type { CandidateScreeningQuestion } from "../screening-v2/model";

/**
 * Local candidate-facing simulation of a screening questionnaire.
 *
 * Callers must supply the validated, allowlisted candidate projection
 * (`CandidateScreeningQuestion`). TypeScript types alone do not remove private
 * fields at runtime; projection is the caller's responsibility. Rendering uses
 * only prompts and options. This local simulation makes no requests, stores no
 * persistent answers and performs no scoring.
 *
 * The installed `Questionnaire` primitive renders a native `<form>`. A form
 * cannot be nested inside another form, so this preview MUST be mounted OUTSIDE
 * the draft editor's wizard form; keeping it a sibling is the caller's
 * responsibility.
 *
 * All questions are optional here because this is a simulation, not the draft
 * validation policy. Answers are never sent or persisted.
 */

const LOCAL_NOTICE = "Vista previa local. Tus respuestas no se envían ni se guardan.";
const RESET_NOTICE = "Al editar las preguntas, la simulación se reinicia.";
const EMPTY_TITLE = "Todavía no hay preguntas";
const EMPTY_DESCRIPTION =
  "Agrega preguntas para simular cómo las respondería una persona candidata.";

/**
 * The installed primitive keeps `sm:min-h-0` on its own controls, so its
 * independent navigation and text controls shrink below the 40px target. The
 * simulation only lifts the minimum back with a presentational class: no paint,
 * no padding and no canonical-variant change.
 */
const MIN_TARGET_HEIGHT = "sm:min-h-11";

type AnswerByQuestion = Record<string, string>;

type SimulationItemDefinition = {
  choices?: readonly { value: string }[];
  name: string;
};

export function DraftQuestionnairePreview({
  questions,
}: {
  questions: CandidateScreeningQuestion[];
}) {
  // Content fingerprint: a plain change of the candidate questions remounts the
  // simulation, so no stale answer can target a new question or a removed
  // option. The first fingerprint is captured once to warn about an edit without
  // a `setState` inside an effect.
  const fingerprint = JSON.stringify(questions);
  const [initialFingerprint] = React.useState(fingerprint);
  const edited = initialFingerprint !== fingerprint;

  return (
    <Card aria-labelledby="draft-questionnaire-preview-heading" data-pf-draft-questionnaire-preview="" className="min-w-0">
      <CardHeader>
        <CardTitle><h3
          id="draft-questionnaire-preview-heading"
          className="font-heading text-sm font-medium text-foreground"
        >
          Simular cuestionario
        </h3></CardTitle>
        <CardDescription className="flex items-start gap-1.5">
          <LockIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>{LOCAL_NOTICE}</span>
        </CardDescription>
        {edited ? (
          <p role="status" className="text-xs text-muted-foreground">
            {RESET_NOTICE}
          </p>
        ) : null}
      </CardHeader>
      <CardContent>
      {questions.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{EMPTY_TITLE}</EmptyTitle>
            <EmptyDescription>{EMPTY_DESCRIPTION}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <QuestionnaireSimulation key={fingerprint} questions={questions} />
      )}
      </CardContent>
    </Card>
  );
}

/**
 * One mounted simulation. It is remounted by its parent whenever the candidate
 * questions change, which is what resets every answer at once.
 */
function QuestionnaireSimulation({
  questions,
}: {
  questions: CandidateScreeningQuestion[];
}) {
  const [currentId, setCurrentId] = React.useState(() => questions[0].id);
  const [answers, setAnswers] = React.useState<AnswerByQuestion>({});

  // The primitive validates every definition against its rendered item. Open
  // questions declare an empty choice list; single-choice questions declare
  // exactly their rendered options so the shortcut/consistency check stays
  // silent.
  const items = React.useMemo<SimulationItemDefinition[]>(
    () =>
      questions.map((question) =>
        question.type === "single_choice"
          ? {
              name: question.id,
              choices: question.options.map((option) => ({ value: option.id })),
            }
          : { name: question.id, choices: [] },
      ),
    [questions],
  );

  const currentIndex = Math.max(
    0,
    questions.findIndex((question) => question.id === currentId),
  );

  const setAnswer = (questionId: string, value: string) => {
    setAnswers((previous) => ({ ...previous, [questionId]: value }));
  };

  return (
    <Questionnaire
      item={currentId}
      items={items}
      onItemChange={(itemName) => setCurrentId(itemName)}
      onSubmit={(event) => {
        // A local simulation must never submit anywhere.
        event.preventDefault();
      }}
    >
      <QuestionnaireProgress
        aria-label="Progreso del cuestionario"
        aria-valuenow={currentIndex + 1}
        aria-valuetext={`Pregunta ${currentIndex + 1} de ${questions.length}`}
      >
        {`Pregunta ${currentIndex + 1} de ${questions.length}`}
      </QuestionnaireProgress>

      {questions.map((question) => (
        <QuestionnaireItem key={question.id} name={question.id}>
          <QuestionnaireTitle>{question.prompt}</QuestionnaireTitle>
          {question.type === "single_choice" ? (
            <QuestionnaireChoices>
              {question.options.map((option) => (
                <QuestionnaireChoice
                  key={option.id}
                  value={option.id}
                  checked={answers[question.id] === option.id}
                  onChange={() => setAnswer(question.id, option.id)}
                >
                  {option.label}
                </QuestionnaireChoice>
              ))}
            </QuestionnaireChoices>
          ) : (
            <QuestionnaireInput
              aria-label={question.prompt}
              className={MIN_TARGET_HEIGHT}
              value={answers[question.id] ?? ""}
              onChange={(event) => setAnswer(question.id, event.target.value)}
            />
          )}
        </QuestionnaireItem>
      ))}

      <QuestionnaireActions>
        <QuestionnairePrevious className={MIN_TARGET_HEIGHT}>
          Anterior
        </QuestionnairePrevious>
        <QuestionnaireSkip className={MIN_TARGET_HEIGHT}>Omitir</QuestionnaireSkip>
        <QuestionnaireNext className={MIN_TARGET_HEIGHT}>Siguiente</QuestionnaireNext>
        <QuestionnaireSubmit className={MIN_TARGET_HEIGHT}>
          Finalizar simulación
        </QuestionnaireSubmit>
      </QuestionnaireActions>
    </Questionnaire>
  );
}

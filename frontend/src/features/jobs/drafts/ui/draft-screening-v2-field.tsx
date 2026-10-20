"use client";

import * as React from "react";
import { MessageSquare, PlusIcon, XIcon } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { DraftFormErrors } from "./draft-form-state";
import {
  SCREENING_OPTIONS_MAX,
  SCREENING_QUESTIONS_MAX,
  addScreeningOptionV2,
  addScreeningQuestionV2,
  removeScreeningOptionV2,
  removeScreeningQuestionV2,
  setScreeningCorrectOptionV2,
  updateScreeningOptionV2,
  updateScreeningQuestionV2,
  type DraftScreeningV2Question,
  type DraftScreeningV2State,
  type ScreeningV2QuestionType,
} from "./draft-screening-v2-state";

/**
 * v2 screening-questions editor, organized as one single-open accordion.
 *
 * It edits the raw local buffer only: prompts, types, options and the optional
 * single correct answer. It creates a fresh UUID once per row inside the add
 * event, never reorders or regenerates ids, allows an incomplete/invalid draft
 * to stay visible, and never invents a fake option or a default correct answer.
 * Validation is explicit, on the enclosing form boundary; this surface only
 * renders the errors and associations it is handed.
 *
 * Every question is one official `@shadcn` accordion item with a compact
 * collapsed header (number, raw prompt or "Sin enunciado", human type label and
 * option count) and the full editor inside the panel. Only one panel stays open
 * and the remove action lives inside the panel, never inside the trigger, so no
 * button ever nests in a button. Controls keep a ≥40px target and semantic
 * tokens; the candidate preview remains separate.
 */
export type DraftScreeningV2FieldProps = {
  /** Raw buffer; read-only here, every change goes through `onChange`. */
  questions: DraftScreeningV2State;
  errors: DraftFormErrors;
  onChange: (questions: DraftScreeningV2State) => void;
  /**
   * Monotonic validation-request token. Every increment asks the editor to open
   * the first question that currently carries an error; because it is a token,
   * a repeated submit re-opens that question even when it is already open.
   * `undefined` means "no request".
   */
  openFirstInvalidToken?: number;
};

const QUESTION_TYPE_OPTIONS: { value: ScreeningV2QuestionType; label: string }[] = [
  { value: "open", label: "Abierta (respuesta libre)" },
  { value: "single_choice_informative", label: "Opción única (informativa)" },
  { value: "single_choice_evaluated", label: "Opción única (con respuesta correcta)" },
];

const EMPTY_PROMPT_LABEL = "Sin enunciado";
const OPEN_OPTION_COUNT_LABEL = "Sin opciones";

const isChoiceType = (type: ScreeningV2QuestionType) => type !== "open";

/** Human label of one question type, shared by the select and the summary. */
function humanTypeLabel(type: ScreeningV2QuestionType): string {
  return QUESTION_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? "";
}

/** Active option count of the collapsed summary, without leaking any option id. */
function optionCountLabel(question: DraftScreeningV2Question): string {
  if (question.type === "open") return OPEN_OPTION_COUNT_LABEL;
  const count = question.options.length;
  return `${count} ${count === 1 ? "opción" : "opciones"}`;
}

/** Raw prompt trimmed only for the header; the buffer keeps every character. */
function summaryPrompt(question: DraftScreeningV2Question): string {
  return question.prompt.trim() === "" ? EMPTY_PROMPT_LABEL : question.prompt;
}

/**
 * Stable id of the first question with a current error, walked in buffer order.
 * Any error keyed under `screening_questions.<index>` (including indexed
 * children) marks that question invalid.
 */
function firstErrorQuestionId(
  questions: DraftScreeningV2State,
  errors: DraftFormErrors,
): string | null {
  for (let index = 0; index < questions.length; index += 1) {
    const prefix = `screening_questions.${index}`;
    const invalid = Object.keys(errors).some(
      (key) => key === prefix || key.startsWith(`${prefix}.`),
    );
    if (invalid) return questions[index].id;
  }
  return null;
}

/** One open panel: the complete editor plus the remove action, never in a trigger. */
function ScreeningV2QuestionPanel({
  question,
  index,
  questions,
  errors,
  onChange,
  onRemove,
}: {
  question: DraftScreeningV2Question;
  index: number;
  questions: DraftScreeningV2State;
  errors: DraftFormErrors;
  onChange: (questions: DraftScreeningV2State) => void;
  onRemove: () => void;
}) {
  const n = index + 1;
  const prefix = `screening_questions.${index}`;
  const questionError = errors[prefix];
  const promptError = errors[`${prefix}.prompt`] ?? questionError;
  const typeError = errors[`${prefix}.type`] ?? questionError;
  const optionsGroupError = errors[`${prefix}.options`] ?? questionError;
  const correctError = errors[`${prefix}.correct_option_id`] ?? questionError;

  const promptId = `draft-screening-${n}-prompt`;
  const promptErrorId = `${promptId}-error`;
  const typeId = `draft-screening-${n}-type`;
  const typeLabelId = `${typeId}-label`;
  const typeErrorId = `${typeId}-error`;
  const optionsGroupErrorId = `draft-screening-${n}-options-error`;
  const correctId = `draft-screening-${n}-correct`;
  const correctLabelId = `${correctId}-label`;
  const correctErrorId = `${correctId}-error`;

  const correctItems = question.options.map((option, optionIndex) => ({
    value: option.id,
    label:
      option.label.trim() === ""
        ? `Opción ${n}.${optionIndex + 1} (sin texto)`
        : option.label,
  }));

  return (
    <AccordionContent>
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex justify-end" data-pf-screening-v2-panel-header="">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10 shrink-0"
            aria-label={`Quitar pregunta ${n}`}
            onClick={onRemove}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </div>

        <FieldGroup className="gap-5">
          <Field data-invalid={promptError !== undefined}>
            <FieldLabel htmlFor={promptId}>Enunciado</FieldLabel>
            <Textarea
              id={promptId}
              name={promptId}
              aria-label={`Pregunta ${n}`}
              rows={3}
              value={question.prompt}
              placeholder="Ej. ¿Qué proyecto te enorgullece más?"
              aria-invalid={promptError !== undefined}
              aria-describedby={promptError === undefined ? undefined : promptErrorId}
              onChange={(event) =>
                onChange(
                  updateScreeningQuestionV2(questions, question.id, {
                    prompt: event.target.value,
                  }),
                )
              }
            />
            <FieldError id={promptErrorId}>{promptError}</FieldError>
          </Field>

          <Field data-invalid={typeError !== undefined}>
            <FieldTitle id={typeLabelId}>
              Tipo<span className="sr-only"> de pregunta {n}</span>
            </FieldTitle>
            <Select
              value={question.type}
              items={QUESTION_TYPE_OPTIONS}
              onValueChange={(next) =>
                onChange(
                  updateScreeningQuestionV2(questions, question.id, {
                    type: (next ?? "open") as ScreeningV2QuestionType,
                  }),
                )
              }
            >
              <SelectTrigger
                id={typeId}
                aria-labelledby={typeLabelId}
                aria-invalid={typeError !== undefined}
                aria-describedby={typeError === undefined ? undefined : typeErrorId}
                className="h-10 w-full text-foreground"
              >
                <SelectValue placeholder="Elige un tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {QUESTION_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldError id={typeErrorId}>{typeError}</FieldError>
          </Field>

          {isChoiceType(question.type) ? (
            <div
              role="group"
              aria-labelledby={`draft-screening-${n}-options-title`}
              data-pf-screening-options=""
              className="flex min-w-0 flex-col gap-4 border-s border-border ps-4 sm:ps-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FieldTitle id={`draft-screening-${n}-options-title`}>
                  Opciones<span className="sr-only"> de la pregunta {n}</span>
                </FieldTitle>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-10"
                  disabled={question.options.length >= SCREENING_OPTIONS_MAX}
                  aria-label={`Agregar opción a la pregunta ${n}`}
                  onClick={() => onChange(addScreeningOptionV2(questions, question.id))}
                >
                  <PlusIcon data-icon="inline-start" aria-hidden="true" />
                  Agregar opción
                </Button>
              </div>

              {question.options.map((option, optionIndex) => {
                const optionId = `draft-screening-${n}-option-${optionIndex + 1}`;
                const optionErrorId = `${optionId}-error`;
                const optionError =
                  errors[`${prefix}.options.${optionIndex}.label`] ??
                  errors[`${prefix}.options.${optionIndex}.id`] ??
                  questionError;
                return (
                  <div key={option.id} className="flex items-end gap-2">
                    <Field data-invalid={optionError !== undefined}>
                      <FieldLabel htmlFor={optionId}>
                        Opción {optionIndex + 1}
                      </FieldLabel>
                      <Input
                        id={optionId}
                        name={optionId}
                        aria-label={`Opción ${n}.${optionIndex + 1}`}
                        value={option.label}
                        autoComplete="off"
                        className="min-h-10"
                        placeholder="Escribe la opción"
                        aria-invalid={optionError !== undefined}
                        aria-describedby={
                          optionError === undefined ? undefined : optionErrorId
                        }
                        onChange={(event) =>
                          onChange(
                            updateScreeningOptionV2(
                              questions,
                              question.id,
                              option.id,
                              { label: event.target.value },
                            ),
                          )
                        }
                      />
                      <FieldError id={optionErrorId}>{optionError}</FieldError>
                    </Field>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-10 shrink-0"
                      aria-label={`Quitar opción ${n}.${optionIndex + 1}`}
                      onClick={() =>
                        onChange(
                          removeScreeningOptionV2(questions, question.id, option.id),
                        )
                      }
                    >
                      <XIcon aria-hidden="true" />
                    </Button>
                  </div>
                );
              })}

              <FieldError id={optionsGroupErrorId}>{optionsGroupError}</FieldError>
              <FieldDescription>
                {question.options.length} de {SCREENING_OPTIONS_MAX} opciones
              </FieldDescription>

              {question.type === "single_choice_evaluated" ? (
                <Field data-invalid={correctError !== undefined}>
                  <FieldTitle id={correctLabelId}>
                    Respuesta correcta<span className="sr-only"> de la pregunta {n}</span>
                  </FieldTitle>
                  <Select
                    value={question.correctOptionId === "" ? null : question.correctOptionId}
                    items={correctItems}
                    onValueChange={(next) =>
                      onChange(
                        setScreeningCorrectOptionV2(questions, question.id, next ?? ""),
                      )
                    }
                  >
                    <SelectTrigger
                      id={correctId}
                      aria-labelledby={correctLabelId}
                      aria-invalid={correctError !== undefined}
                      aria-describedby={
                        correctError === undefined ? undefined : correctErrorId
                      }
                      className="h-10 w-full text-foreground"
                    >
                      <SelectValue placeholder="Elige la opción correcta" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {correctItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldError id={correctErrorId}>{correctError}</FieldError>
                </Field>
              ) : null}
            </div>
          ) : null}
        </FieldGroup>
      </div>
    </AccordionContent>
  );
}

export function DraftScreeningV2Field({
  questions,
  errors,
  onChange,
  openFirstInvalidToken,
}: DraftScreeningV2FieldProps) {
  const atLimit = questions.length >= SCREENING_QUESTIONS_MAX;
  const limitError = errors.screening_questions;
  const [openId, setOpenId] = React.useState<string | null>(null);
  const appliedTokenRef = React.useRef(0);

  // One explicit validation request opens the first invalid question. The ref
  // makes the request edge-triggered, so an unchanged token never fights a
  // manual collapse while a new token always re-opens the offending question.
  React.useEffect(() => {
    if (openFirstInvalidToken === undefined) return;
    if (openFirstInvalidToken === appliedTokenRef.current) return;
    appliedTokenRef.current = openFirstInvalidToken;
    const invalidId = firstErrorQuestionId(questions, errors);
    if (invalidId !== null) setOpenId(invalidId);
  }, [openFirstInvalidToken, questions, errors]);

  function handleAddQuestion() {
    const next = addScreeningQuestionV2(questions);
    if (next.length === questions.length) return;
    onChange(next);
    setOpenId(next[next.length - 1].id);
  }

  function handleRemoveQuestion(questionId: string) {
    const index = questions.findIndex((question) => question.id === questionId);
    const next = removeScreeningQuestionV2(questions, questionId);
    onChange(next);
    if (openId !== questionId) return;
    // Predictable neighbor: previous question, else the following one, else the
    // empty state. No removed id survives in the controlled accordion value.
    const neighbor = next[index - 1] ?? next[index] ?? null;
    setOpenId(neighbor === null ? null : neighbor.id);
  }

  const addAction = (
    <div className="flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
      <Button type="button" variant="outline" size="sm" className="min-h-10 w-full sm:w-auto" disabled={atLimit} onClick={handleAddQuestion}>
        <PlusIcon data-icon="inline-start" aria-hidden="true" />
        Agregar pregunta
      </Button>
      <FieldDescription>{questions.length} de {SCREENING_QUESTIONS_MAX}</FieldDescription>
    </div>
  );

  return (
    <FieldGroup className="gap-5" data-pf-screening-v2="">
      {questions.length === 0 ? (
        <Empty>
          <EmptyHeader className="max-w-md">
            <EmptyMedia variant="icon"><MessageSquare aria-hidden="true" /></EmptyMedia>
            <EmptyTitle>La conversación empieza aquí</EmptyTitle>
            <EmptyDescription>Agrega preguntas para conocer la experiencia y las expectativas de cada persona. También puedes continuar sin ellas.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{addAction}</EmptyContent>
        </Empty>
      ) : (
        <Accordion
          data-pf-screening-v2-list=""
          value={openId === null ? [] : [openId]}
          onValueChange={(value) => {
            const next = Array.isArray(value) ? value[0] : value;
            setOpenId(typeof next === "string" ? next : null);
          }}
        >
          {questions.map((question, index) => {
            const n = index + 1;
            const promptLabel = summaryPrompt(question);
            const typeLabel = humanTypeLabel(question.type);
            const countLabel = optionCountLabel(question);
            return (
              <AccordionItem
                key={question.id}
                value={question.id}
                data-pf-screening-v2-question=""
                className="min-w-0"
              >
                <AccordionTrigger
                  data-pf-screening-v2-trigger=""
                  className="min-h-10 items-center gap-3"
                  aria-label={`Pregunta ${n}: ${promptLabel} · ${typeLabel} · ${countLabel}`}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-1 text-left">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                        {`Pregunta ${n}`}
                      </span>
                      <span className="min-w-0 truncate font-medium text-foreground">
                        {promptLabel}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-normal text-muted-foreground">
                      <span>{typeLabel}</span>
                      <span aria-hidden="true">·</span>
                      <span>{countLabel}</span>
                    </span>
                  </span>
                </AccordionTrigger>
                <ScreeningV2QuestionPanel
                  question={question}
                  index={index}
                  questions={questions}
                  errors={errors}
                  onChange={onChange}
                  onRemove={() => handleRemoveQuestion(question.id)}
                />
              </AccordionItem>
            );
          })}
        </Accordion>
      )}

      {questions.length > 0 && addAction}
      <FieldError id="draft-screening-limit-error">{limitError}</FieldError>
    </FieldGroup>
  );
}

import type { z } from "zod";

import type { DraftModel } from "../model";
import {
  screeningQuestionsV2Schema,
  toCandidateScreeningQuestions,
  type CandidateScreeningQuestion,
  type ScreeningQuestionV2,
} from "../screening-v2/model";
import {
  validateDraftFormState,
  type DraftFormErrors,
  type DraftFormState,
} from "./draft-form-state";
import {
  GENERIC_ERROR,
  SCREENING_EMPTY_ERROR,
  SCREENING_TOO_LONG_ERROR,
  SCREENING_V2_CORRECT_ERROR,
  SCREENING_V2_OPTION_DUPLICATE_ERROR,
  SCREENING_V2_OPTION_EMPTY_ERROR,
  SCREENING_V2_OPTION_ID_ERROR,
  SCREENING_V2_OPTION_TOO_LONG_ERROR,
  SCREENING_V2_OPTIONS_MAX_ERROR,
  SCREENING_V2_OPTIONS_MIN_ERROR,
  SCREENING_V2_QUESTION_ID_ERROR,
  SCREENING_V2_QUESTION_LIMIT_ERROR,
  SCREENING_V2_TYPE_ERROR,
} from "./draft-messages";

/**
 * Raw local buffer of the v2 screening editor.
 *
 * This is a **local authoring buffer**, not the accepted model and not a wire
 * body. Every control owns the raw text the user typed and every active/inactive
 * variant key stays buffered so switching a question type never silently erases
 * what was already written, mirroring the accepted compensation buffering.
 *
 * IDs are authoring-level identity: each row gets a `crypto.randomUUID()` once,
 * inside the add event (never during SSR/render), and is never regenerated or
 * case-changed on edits, type switches or reordering. Legacy v1 rows are never
 * converted into v2 IDs: the two versions stay apart and the caller decides.
 */

/** Contract bound: at most 100 questions per draft. */
export const SCREENING_QUESTIONS_MAX = 100;
/** Contract bound: 2–8 options per single-choice question. */
export const SCREENING_OPTIONS_MIN = 2;
export const SCREENING_OPTIONS_MAX = 8;

/** The three explicit v2 question types. */
export type ScreeningV2QuestionType =
  | "open"
  | "single_choice_informative"
  | "single_choice_evaluated";

/** One raw option row: stable authoring id plus the exact typed label. */
export type DraftScreeningV2Option = { id: string; label: string };

/** One raw question row; inactive variant keys stay buffered in place. */
export type DraftScreeningV2Question = {
  id: string;
  type: ScreeningV2QuestionType;
  prompt: string;
  /** Buffered even for `open`; only composed for single-choice types. */
  options: DraftScreeningV2Option[];
  /** Buffered even when the type is not evaluated; only composed for it. */
  correctOptionId: string;
};

/** The complete ordered raw screening buffer of one draft. */
export type DraftScreeningV2State = DraftScreeningV2Question[];

/** One fresh UUIDv4 created once per row, from inside an event handler. */
export function createRowUUID(): string {
  return globalThis.crypto.randomUUID();
}

/** A fresh empty question row: real type is chosen by the user, no fake content. */
export function createScreeningQuestionV2(): DraftScreeningV2Question {
  return {
    id: createRowUUID(),
    type: "open",
    prompt: "",
    options: [],
    correctOptionId: "",
  };
}

/**
 * Seed the raw buffer from already-validated v2 authoring questions. Every
 * supplied ID is preserved verbatim; nothing is generated or migrated here.
 */
export function toDraftScreeningV2State(
  questions: readonly ScreeningQuestionV2[],
): DraftScreeningV2State {
  return questions.map((question) => ({
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    options:
      question.type === "open"
        ? []
        : question.options.map((option) => ({ id: option.id, label: option.label })),
    correctOptionId:
      question.type === "single_choice_evaluated" ? question.correct_option_id : "",
  }));
}

/**
 * Compose one raw row for the accepted v2 schema, including **only the keys of
 * the active variant**. Inactive options/correct-answer buffers never leak into
 * the composed value and are never erased from the raw buffer.
 */
export function composeScreeningQuestionV2(
  question: DraftScreeningV2Question,
): Record<string, unknown> {
  if (question.type === "open") {
    return { id: question.id, type: "open", prompt: question.prompt };
  }
  const options = question.options.map((option) => ({
    id: option.id,
    label: option.label,
  }));
  if (question.type === "single_choice_informative") {
    return {
      id: question.id,
      type: "single_choice_informative",
      prompt: question.prompt,
      options,
    };
  }
  return {
    id: question.id,
    type: "single_choice_evaluated",
    prompt: question.prompt,
    options,
    correct_option_id: question.correctOptionId,
  };
}

/** Compose the complete ordered raw buffer, active keys only. */
export function composeScreeningQuestionsV2(
  state: DraftScreeningV2State,
): Record<string, unknown>[] {
  return state.map(composeScreeningQuestionV2);
}

/** Append one fresh question unless the contract bound is already reached. */
export function addScreeningQuestionV2(
  state: DraftScreeningV2State,
): DraftScreeningV2State {
  if (state.length >= SCREENING_QUESTIONS_MAX) return state;
  return [...state, createScreeningQuestionV2()];
}

/** Remove one question by its stable id, preserving the order of the rest. */
export function removeScreeningQuestionV2(
  state: DraftScreeningV2State,
  questionId: string,
): DraftScreeningV2State {
  return state.filter((question) => question.id !== questionId);
}

/**
 * Patch one question in place. A type change keeps the buffered options and the
 * buffered correct-answer reference untouched; only composition decides which
 * keys are active.
 */
export function updateScreeningQuestionV2(
  state: DraftScreeningV2State,
  questionId: string,
  patch: Partial<Omit<DraftScreeningV2Question, "id">>,
): DraftScreeningV2State {
  return state.map((question) =>
    question.id === questionId ? { ...question, ...patch } : question,
  );
}

/** Append one empty option unless the 8-option bound is already reached. */
export function addScreeningOptionV2(
  state: DraftScreeningV2State,
  questionId: string,
): DraftScreeningV2State {
  return state.map((question) => {
    if (question.id !== questionId) return question;
    if (question.options.length >= SCREENING_OPTIONS_MAX) return question;
    return {
      ...question,
      options: [...question.options, { id: createRowUUID(), label: "" }],
    };
  });
}

/**
 * Remove one option, preserving every remaining option id. When the removed
 * option was the referenced correct answer, that reference is cleared instead
 * of pointing at a missing id.
 */
export function removeScreeningOptionV2(
  state: DraftScreeningV2State,
  questionId: string,
  optionId: string,
): DraftScreeningV2State {
  return state.map((question) => {
    if (question.id !== questionId) return question;
    return {
      ...question,
      options: question.options.filter((option) => option.id !== optionId),
      correctOptionId:
        question.correctOptionId === optionId ? "" : question.correctOptionId,
    };
  });
}

/** Patch one option label, leaving the option id and the other rows intact. */
export function updateScreeningOptionV2(
  state: DraftScreeningV2State,
  questionId: string,
  optionId: string,
  patch: Partial<Omit<DraftScreeningV2Option, "id">>,
): DraftScreeningV2State {
  return state.map((question) =>
    question.id === questionId
      ? {
          ...question,
          options: question.options.map((option) =>
            option.id === optionId ? { ...option, ...patch } : option,
          ),
        }
      : question,
  );
}

/**
 * Set the single correct-answer reference. The value must be an actual option
 * id of that question (exact string, no regeneration and no case change); the
 * empty string clears it.
 */
export function setScreeningCorrectOptionV2(
  state: DraftScreeningV2State,
  questionId: string,
  optionId: string,
): DraftScreeningV2State {
  return state.map((question) => {
    if (question.id !== questionId) return question;
    if (optionId !== "" && !question.options.some((option) => option.id === optionId)) {
      return question;
    }
    return { ...question, correctOptionId: optionId };
  });
}

/** Validation outcome of the v2 raw buffer against the accepted v2 schema. */
export type ScreeningV2Validation =
  | { ok: true; questions: ScreeningQuestionV2[] }
  | { ok: false; errors: DraftFormErrors };

/** Plain Spanish message for one v2 issue, keyed by its composed field path. */
function screeningV2Message(key: string, issue: z.ZodIssue): string {
  if (key === "screening_questions") return SCREENING_V2_QUESTION_LIMIT_ERROR;
  if (key.endsWith(".options")) {
    return issue.code === "too_big"
      ? SCREENING_V2_OPTIONS_MAX_ERROR
      : SCREENING_V2_OPTIONS_MIN_ERROR;
  }
  if (key.endsWith(".correct_option_id")) return SCREENING_V2_CORRECT_ERROR;
  if (key.endsWith(".type")) return SCREENING_V2_TYPE_ERROR;
  if (key.endsWith(".prompt")) {
    return issue.message.includes("codepoint") ? SCREENING_TOO_LONG_ERROR : SCREENING_EMPTY_ERROR;
  }
  if (key.endsWith(".label")) {
    if (issue.message.includes("codepoint")) return SCREENING_V2_OPTION_TOO_LONG_ERROR;
    if (issue.message.includes("duplicate")) return SCREENING_V2_OPTION_DUPLICATE_ERROR;
    return SCREENING_V2_OPTION_EMPTY_ERROR;
  }
  if (key.endsWith(".id")) {
    return key.includes(".options.")
      ? SCREENING_V2_OPTION_ID_ERROR
      : SCREENING_V2_QUESTION_ID_ERROR;
  }
  return GENERIC_ERROR;
}

/**
 * Validate the complete raw buffer once through the accepted v2 schema. Invalid
 * input yields field-path-keyed Spanish errors and no questions; it is never
 * partially accepted and the raw buffer is never mutated.
 */
export function validateScreeningQuestionsV2(
  state: DraftScreeningV2State,
): ScreeningV2Validation {
  const parsed = screeningQuestionsV2Schema.safeParse(composeScreeningQuestionsV2(state));
  if (parsed.success) return { ok: true, questions: parsed.data };
  const errors: DraftFormErrors = {};
  for (const issue of parsed.error.issues) {
    const path = issue.path.map(String);
    const key =
      path.length === 0 ? "screening_questions" : `screening_questions.${path.join(".")}`;
    errors[key] ??= screeningV2Message(key, issue);
  }
  return { ok: false, errors };
}

/**
 * A clearly local v2 snapshot: the normalized non-screening write fields plus
 * the validated v2 authoring questions. It is **not** a v1 POST body: the
 * `screening_questions` key carries v2 authoring objects, so it can never be
 * mistaken for, or handed to, the accepted v1 serializer as a valid v1 model.
 */
export type LocalDraftV2Snapshot = {
  fields: Omit<DraftModel["fields"], "screening_questions">;
  screening_questions: ScreeningQuestionV2[];
  requesterName: string | null;
  descriptionPlain: string | null;
};

/** Atomic outcome of the explicit local v2 validation boundary. */
export type LocalDraftV2ValidationResult =
  | { ok: true; model: LocalDraftV2Snapshot }
  | { ok: false; errors: DraftFormErrors };

/**
 * Explicit local v2 validation boundary.
 *
 * The 16 non-screening fields are validated through the accepted v1 serializer
 * with an **internal-only empty `screening_questions` placeholder**, so the v1
 * field rules stay the single source of truth. The v2 questions are validated
 * separately against the accepted v2 schema. Both error sets are combined into
 * one atomic result: no partial snapshot is committed and successful output is
 * a clearly local v2 snapshot, never a fake v1 valid model.
 */
export function validateLocalDraftV2FormState(
  state: DraftFormState,
  baseModel: DraftModel,
  screening: DraftScreeningV2State,
): LocalDraftV2ValidationResult {
  const placeholderState: DraftFormState = { ...state, screening_questions: [] };
  const otherResult = validateDraftFormState(placeholderState, baseModel);
  const screeningResult = validateScreeningQuestionsV2(screening);

  if (!otherResult.ok || !screeningResult.ok) {
    const errors: DraftFormErrors = {
      ...(otherResult.ok ? {} : otherResult.errors),
      ...(screeningResult.ok ? {} : screeningResult.errors),
    };
    return { ok: false, errors };
  }

  const otherFields = { ...otherResult.model.fields } as Partial<DraftModel["fields"]>;
  delete otherFields.screening_questions;
  return {
    ok: true,
    model: {
      fields: otherFields as Omit<DraftModel["fields"], "screening_questions">,
      screening_questions: screeningResult.questions,
      requesterName: otherResult.model.requesterName,
      descriptionPlain: otherResult.model.descriptionPlain,
    },
  };
}

/**
 * Presentation-only candidate projection of the raw buffer. Valid questions
 * project through the accepted allowlist; invalid questions return their errors
 * so a caller can show a correction message instead of a silent empty success.
 */
export type CandidateScreeningProjection =
  | { ok: true; questions: CandidateScreeningQuestion[] }
  | { ok: false; errors: DraftFormErrors };

export function projectCandidateScreeningV2(
  state: DraftScreeningV2State,
): CandidateScreeningProjection {
  const screening = validateScreeningQuestionsV2(state);
  if (!screening.ok) return { ok: false, errors: screening.errors };
  return { ok: true, questions: toCandidateScreeningQuestions(screening.questions) };
}

import { z } from "zod";

import { trimUnicodeWhiteSpace } from "../text";

/**
 * Local screening-question model v2 for the private vacancy draft slice
 * (`docs/contracts/private-vacancy-drafts-v2-screening.md` §2 and §6).
 *
 * This is a pure, transport-free authoring value: a strict validation model for
 * the three agreed question variants plus their allowlisted candidate-facing
 * projection. It is deliberately **not** a transport schema, a request/response
 * envelope, the full 17-field draft serializer or any HTTP/storage/UI/BFF/
 * backend integration. It performs no UUID generation: IDs are authoring-level
 * identity supplied by the caller and are always preserved verbatim.
 *
 * These rules mirror the accepted design; they are not a claim that the backend
 * enforces them yet. The backend remains the privacy owner of screening data and
 * must revalidate every candidate projection before any exposure. No public
 * draft or candidate-answers endpoint is created here.
 */

/** Contract bound: at most 100 questions per draft. */
const QUESTION_MAX_ITEMS = 100;
/** Contract bound: at most 2000 codepoints per prompt after trimming. */
const PROMPT_MAX_CODE_POINTS = 2000;
/** Contract bound: 2–8 options per single-choice question. */
const OPTION_MIN_ITEMS = 2;
const OPTION_MAX_ITEMS = 8;
/** Contract bound: at most 200 codepoints per option label after trimming. */
const LABEL_MAX_CODE_POINTS = 200;

/** Codepoint count: astral characters count as one, not two UTF-16 units. */
const countCodePoints = (value: string): number => [...value].length;

/**
 * Stable authoring ID: UUIDv4 (version nibble `4`) with the RFC 4122 variant
 * nibble `8`–`b`. Hex case is irrelevant to ID identity: shape validity and
 * duplicate detection are case-insensitive, while the exact submitted string is
 * always preserved in the output (see the uniqueness checks below).
 */
const UUID_V4_RFC = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidV4Schema = z.string().regex(UUID_V4_RFC, "must be a UUIDv4 with an RFC 4122 variant");

/**
 * One option: strict `{ id, label }` only. The label is trimmed at Unicode ends,
 * then required non-empty, then bounded in codepoints. No other normalization is
 * applied: no NFC, no casefolding and no interior collapsing.
 */
const optionSchema = z
  .object({ id: uuidV4Schema, label: z.string() })
  .strict()
  .transform((option, context) => {
    const label = trimUnicodeWhiteSpace(option.label);
    if (label.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["label"],
        message: "option label is empty after trimming",
      });
      return z.NEVER;
    }
    if (countCodePoints(label) > LABEL_MAX_CODE_POINTS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["label"],
        message: "option label exceeds the codepoint limit",
      });
      return z.NEVER;
    }
    return { id: option.id, label };
  });

/**
 * The strict option list: 2–8 options, order preserved, option IDs unique within
 * the question and exact-trimmed labels unique within the question. Duplicate
 * detection runs on the already-trimmed label, so `"a"` and `" a "` collide.
 * Option IDs compare case-insensitively (a UUID has one value regardless of hex
 * case) while the submitted ID strings are preserved verbatim in the output.
 */
const optionsSchema = z
  .array(optionSchema)
  .min(OPTION_MIN_ITEMS)
  .max(OPTION_MAX_ITEMS)
  .superRefine((options, context) => {
    const seenIds = new Set<string>();
    const seenLabels = new Set<string>();
    options.forEach((option, index) => {
      // A failed option transform aborts that item; its own issue is already
      // recorded, so uniqueness only considers fully parsed options.
      if (typeof option?.id !== "string") return;
      const idKey = option.id.toLowerCase();
      if (seenIds.has(idKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "id"],
          message: "duplicate option id within the question",
        });
      } else {
        seenIds.add(idKey);
      }
      if (seenLabels.has(option.label)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "label"],
          message: "duplicate option label after trimming",
        });
      } else {
        seenLabels.add(option.label);
      }
    });
  });

/**
 * Shared prompt rule: Unicode White_Space trim, then required non-empty, then
 * the 2000-codepoint bound. Duplicate prompts across questions are legal, so no
 * cross-question prompt uniqueness is applied.
 */
const promptSchema = z.string().transform((raw, context) => {
  const prompt = trimUnicodeWhiteSpace(raw);
  if (prompt.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [],
      message: "prompt is empty after trimming",
    });
    return z.NEVER;
  }
  if (countCodePoints(prompt) > PROMPT_MAX_CODE_POINTS) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [],
      message: "prompt exceeds the codepoint limit",
    });
    return z.NEVER;
  }
  return prompt;
});

/** `open`: strict `{ id, type, prompt }`; `options` and `correct_option_id` are forbidden. */
const openQuestionSchema = z
  .object({
    id: uuidV4Schema,
    type: z.literal("open"),
    prompt: promptSchema,
  })
  .strict();

/** `single_choice_informative`: adds required `options`; `correct_option_id` is forbidden. */
const singleChoiceInformativeQuestionSchema = z
  .object({
    id: uuidV4Schema,
    type: z.literal("single_choice_informative"),
    prompt: promptSchema,
    options: optionsSchema,
  })
  .strict();

/**
 * `single_choice_evaluated`: adds required `options` and a required, non-null
 * `correct_option_id`. The membership rule is applied to the discriminated union
 * below, so each variant stays a plain strict object.
 */
const singleChoiceEvaluatedQuestionSchema = z
  .object({
    id: uuidV4Schema,
    type: z.literal("single_choice_evaluated"),
    prompt: promptSchema,
    options: optionsSchema,
    correct_option_id: uuidV4Schema,
  })
  .strict();

/**
 * Discriminated strict union over the three agreed `type` literals. An unknown
 * `type` is rejected; there is no fallback variant and no key stripping. A valid
 * `type` delegates to exactly its own strict variant, so missing, extra and
 * malformed keys surface as that variant's own issues.
 */
const questionV2Schema = z.discriminatedUnion("type", [
  openQuestionSchema,
  singleChoiceInformativeQuestionSchema,
  singleChoiceEvaluatedQuestionSchema,
]);

/**
 * `correct_option_id` is required, non-null and must match exactly one member of
 * `options[].id`. Membership is a **literal exact-string** comparison: an
 * uppercase reference does not match a stored lowercase option ID even though
 * the two IDs are the same UUID value. A caller or UI must reference the stored
 * option ID string byte-for-byte to avoid a reference mismatch.
 */
const authoredQuestionSchema = questionV2Schema.superRefine((question, context) => {
  if (question.type !== "single_choice_evaluated") return;
  const matches = question.options.filter((option) => option.id === question.correct_option_id);
  if (matches.length !== 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["correct_option_id"],
      message: "correct_option_id must match exactly one option id",
    });
  }
});

/**
 * A questionnaire: at most 100 questions, order preserved, question IDs unique
 * within the questionnaire. Question-ID uniqueness compares case-insensitively
 * so two spellings of the same UUID cannot both appear, while every submitted ID
 * string is preserved verbatim. IDs are never reassigned; the output is the
 * caller's input with prompts and labels trimmed and everything else preserved.
 */
export const screeningQuestionsV2Schema = z
  .array(authoredQuestionSchema)
  .max(QUESTION_MAX_ITEMS)
  .superRefine((questions, context) => {
    const seenIds = new Set<string>();
    questions.forEach((question, index) => {
      // A failed question transform aborts that item; its own issue is already
      // recorded, so uniqueness only considers fully parsed questions.
      if (typeof question?.id !== "string") return;
      const idKey = question.id.toLowerCase();
      if (seenIds.has(idKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "id"],
          message: "duplicate question id within the questionnaire",
        });
      } else {
        seenIds.add(idKey);
      }
    });
  });

/** One validated employer-authoring question (any of the three variants). */
export type ScreeningQuestionV2 = z.output<typeof screeningQuestionsV2Schema>[number];

/**
 * Candidate-facing projection: the server allowlist of §6. The **evaluated**
 * distinction is hidden — both single-choice variants project to
 * `type: "single_choice"`. There is no answer key, evaluation flag or score, and
 * absent data is omitted instead of serialized as `null`.
 */
export type CandidateScreeningQuestion =
  | { id: string; type: "open"; prompt: string }
  | {
      id: string;
      type: "single_choice";
      prompt: string;
      options: { id: string; label: string }[];
    };

/**
 * Validate private employer input **first**, then project it through an explicit
 * allowlist into detached candidate objects and option arrays. Invalid input
 * throws a `ZodError`; it is never partially projected or rendered as if valid.
 * The employer object is not spread, no validated value is cast from `unknown`
 * and the input is never mutated.
 */
export function toCandidateScreeningQuestions(input: unknown): CandidateScreeningQuestion[] {
  const questions = screeningQuestionsV2Schema.parse(input);
  return questions.map((question): CandidateScreeningQuestion => {
    if (question.type === "open") {
      return { id: question.id, type: "open", prompt: question.prompt };
    }
    return {
      id: question.id,
      type: "single_choice",
      prompt: question.prompt,
      options: question.options.map((option) => ({ id: option.id, label: option.label })),
    };
  });
}

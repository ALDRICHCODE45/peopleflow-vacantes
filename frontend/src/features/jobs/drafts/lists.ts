import { z } from "zod";
import { trimUnicodeWhiteSpace } from "./text";

/**
 * Four individual `fields.*` list validators for the private vacancy draft
 * slice (`docs/contracts/private-vacancy-drafts-v1.md` §3, §4, §4.4, §4.5).
 *
 * Zod-only: no React, no transport, no server-only import. Each schema
 * validates exactly one list field, so a later composition unit owns `POST`
 * omission semantics, unknown keys, `empty_patch` handling and the enclosing
 * request body. These rules mirror the accepted design; they are not a claim
 * that the backend enforces them yet, so a future backend unit must revalidate
 * every one.
 */

/** Contract list bound for `skills`, `custom_benefits` and `screening_questions`. */
const LIST_MAX_ITEMS = 100;
/** Per-item codepoint bound for `skills` / `custom_benefits`. */
const STRING_ITEM_MAX_CODE_POINTS = 200;
/** `benefits` is a fixed eight-code catalog, so its bound is the catalog size. */
const BENEFITS_MAX_ITEMS = 8;
/** Per-prompt codepoint bound for `screening_questions`. */
const SCREENING_PROMPT_MAX_CODE_POINTS = 2000;

/** Codepoint count: astral characters count as one, not two UTF-16 units. */
const countCodePoints = (value: string): number => [...value].length;

/**
 * Shared trimmed string list rule: each item is trimmed at Unicode ends, then
 * required non-empty, then bounded in codepoints; literal duplicates after
 * trimming are rejected at the offending index. Order is preserved and no
 * dedupe, casefolding, NFC or sorting is applied. Duplicate detection runs on
 * the trimmed value, so `"a"` and `" a "` are the same item.
 */
const trimmedStringListSchema = (maxItems: number, maxItemCodePoints: number) =>
  z
    .array(z.string())
    .max(maxItems)
    .transform((items, context) => {
      const trimmedItems = items.map((item) => trimUnicodeWhiteSpace(item));
      const seen = new Set<string>();
      let valid = true;
      trimmedItems.forEach((item, index) => {
        if (item.length === 0) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index],
            message: "list item is empty after trimming",
          });
          valid = false;
          return;
        }
        if (countCodePoints(item) > maxItemCodePoints) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index],
            message: "list item exceeds the codepoint limit",
          });
          valid = false;
          return;
        }
        if (seen.has(item)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index],
            message: "duplicate list item after trimming",
          });
          return;
        }
        seen.add(item);
      });
      return valid ? trimmedItems : z.NEVER;
    });

/** `skills`: trimmed items ≤200 codepoints, ≤100 literal-distinct items. */
export const draftSkillsSchema = trimmedStringListSchema(
  LIST_MAX_ITEMS,
  STRING_ITEM_MAX_CODE_POINTS,
);
/** `custom_benefits`: same rule as `skills`, with its own independent list. */
export const draftCustomBenefitsSchema = trimmedStringListSchema(
  LIST_MAX_ITEMS,
  STRING_ITEM_MAX_CODE_POINTS,
);

/** Exact `benefits` catalog (§4.4); submitted order is preserved, never trimmed. */
export const BENEFITS = [
  "health_insurance",
  "computer_equipment",
  "flexible_schedule",
  "remote_stipend",
  "training_budget",
  "extra_time_off",
  "wellness",
  "annual_bonus",
] as const;

/**
 * `benefits`: exact catalog codes, unique, ≤8 items and never trimmed. Because
 * the catalog has eight codes, a full list is a permutation of the catalog in
 * the order the client submitted.
 */
export const draftBenefitsSchema = z
  .array(z.enum(BENEFITS))
  .max(BENEFITS_MAX_ITEMS)
  .superRefine((items, context) => {
    const seen = new Set<(typeof BENEFITS)[number]>();
    items.forEach((item, index) => {
      if (seen.has(item)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: "duplicate benefit code",
        });
        return;
      }
      seen.add(item);
    });
  });

/**
 * One `screening_questions` item: a strict object with only a trimmed
 * non-empty `prompt` of ≤2000 codepoints. No UI id, answer or knockout key is
 * accepted, and duplicate prompts are allowed across the list.
 */
const screeningQuestionSchema = z
  .object({ prompt: z.string() })
  .strict()
  .transform((value, context) => {
    const prompt = trimUnicodeWhiteSpace(value.prompt);
    if (prompt.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["prompt"],
        message: "prompt is empty after trimming",
      });
      return z.NEVER;
    }
    if (countCodePoints(prompt) > SCREENING_PROMPT_MAX_CODE_POINTS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["prompt"],
        message: "prompt exceeds the codepoint limit",
      });
      return z.NEVER;
    }
    return { prompt };
  });

/** `screening_questions`: ≤100 strict prompt objects, order preserved. */
export const draftScreeningQuestionsSchema = z
  .array(screeningQuestionSchema)
  .max(LIST_MAX_ITEMS);

/**
 * Reusable per-field schema map. Deliberately not a request parser: composing a
 * partial or complete `fields` object is a later unit's responsibility.
 */
export const draftListFieldSchemas = {
  skills: draftSkillsSchema,
  custom_benefits: draftCustomBenefitsSchema,
  benefits: draftBenefitsSchema,
  screening_questions: draftScreeningQuestionsSchema,
} as const;

/** One of the four contract-defined list field names. */
export type DraftListField = keyof typeof draftListFieldSchemas;

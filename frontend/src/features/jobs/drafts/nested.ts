import { z } from "zod";
import { trimUnicodeWhiteSpace } from "./text";

/**
 * Two nested `fields.*` write validators for the private vacancy draft slice
 * (`docs/contracts/private-vacancy-drafts-v1.md` §3, §4.2, §4.3): `requester`
 * and `languages`.
 *
 * Zod-only: no React, no transport, no server-only import. Each schema
 * validates exactly one field value, so a later composition unit owns
 * `POST`/`PATCH` omission semantics and the enclosing request body. These rules
 * mirror the accepted design; a future backend unit must revalidate all of
 * them. Nothing here asserts current backend behavior, authentication state or
 * catalog membership: whether a requester id belongs to the caller's
 * organization and kind is a backend check a client cannot perform.
 */

/** Accepted `requester.kind` literals; never defaulted or trimmed. */
export const REQUESTER_KINDS = ["internal_area", "client"] as const;
/** Accepted `languages[].language` literals. */
export const LANGUAGE_CODES = ["es", "en", "other"] as const;
/** Accepted `languages[].level` literals; `null` is also allowed. */
export const LANGUAGE_LEVELS = ["basic", "intermediate", "advanced", "native"] as const;

/** Contract list bound for `languages` (§4.3). */
const LANGUAGES_MAX_ITEMS = 100;
/** Per-item codepoint bound for `custom_name`, measured after trimming. */
const CUSTOM_NAME_MAX_CODE_POINTS = 200;

/** Codepoint count: astral characters count as one, not two UTF-16 units. */
const countCodePoints = (value: string): number => [...value].length;

/**
 * `requester` (§4.2): `null` or a strict object requiring exactly `kind` and a
 * nullable UUID `id`. The derived read-only `name` and every unknown key are
 * rejected, and there is no implicit or default selection. `id` uses the
 * existing Zod UUID check with no version policy, no case normalization and no
 * trimming, so a valid UUID is preserved byte-for-byte. Organization ownership
 * and same-`kind` membership stay backend checks.
 */
export const draftRequesterSchema = z
  .object({
    kind: z.enum(REQUESTER_KINDS),
    id: z.string().uuid().nullable(),
  })
  .strict()
  .nullable();

/**
 * One `languages` item (§4.3): a strict object with all three keys required and
 * no optional field or default. `custom_name` is normalized first (Unicode
 * end-trim, empty becomes `null`) and only then validated, so an all-whitespace
 * name becomes `null` like other contract text while a substantive name for
 * `es`/`en` is rejected instead of being silently erased. No NFC, case folding
 * or interior collapsing is applied.
 */
const languageItemSchema = z
  .object({
    language: z.enum(LANGUAGE_CODES),
    custom_name: z.string().nullable(),
    level: z.enum(LANGUAGE_LEVELS).nullable(),
  })
  .strict()
  .transform((value, context) => {
    const trimmed = value.custom_name === null ? null : trimUnicodeWhiteSpace(value.custom_name);
    const customName = trimmed === "" ? null : trimmed;

    if (customName !== null && countCodePoints(customName) > CUSTOM_NAME_MAX_CODE_POINTS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["custom_name"],
        message: "custom_name exceeds the codepoint limit",
      });
      return z.NEVER;
    }
    if (customName !== null && value.language !== "other") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["custom_name"],
        message: "custom_name must be null for es and en",
      });
      return z.NEVER;
    }
    return { language: value.language, custom_name: customName, level: value.level };
  });

/**
 * `languages` (§4.3): an ordered array, empty allowed, ≤100 items and never
 * `null`/`undefined`. Duplicate entries and submitted order are preserved; no
 * dedupe, CEFR conversion, sorting, case folding or NFC is applied.
 */
export const draftLanguagesSchema = z.array(languageItemSchema).max(LANGUAGES_MAX_ITEMS);

/**
 * Reusable per-field schema map. Deliberately not a request parser: composing a
 * complete or partial `fields` object is a later unit's responsibility.
 */
export const draftNestedFieldSchemas = {
  requester: draftRequesterSchema,
  languages: draftLanguagesSchema,
} as const;

/** One of the two contract-defined nested field names. */
export type DraftNestedField = keyof typeof draftNestedFieldSchemas;
/** Validated `requester` value: `null` or `{ kind, id }`. */
export type DraftRequester = z.output<typeof draftRequesterSchema>;
/** One validated `languages` item, preserving item order. */
export type DraftLanguage = z.output<typeof draftLanguagesSchema>[number];

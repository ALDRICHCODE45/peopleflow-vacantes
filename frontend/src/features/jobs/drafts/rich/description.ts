import { z } from "zod";

import { encodeGoJsonV1, GoJsonV1EncodeError } from "./canonical";
import { draftRichDescriptionStructureSchema, type DraftRichDescription } from "./grammar";
import {
  DRAFT_DESCRIPTION_PLAIN_MAX_BYTES,
  DraftDescriptionPlainBudgetError,
  deriveDraftDescriptionPlain,
} from "./plain";

/**
 * Composed rich-description prevalidation for the private vacancy draft write
 * DTO (`docs/contracts/private-vacancy-drafts-v1.md` §5.1-§5.3; canonical
 * addendum `docs/contracts/private-vacancy-drafts-canonical-json-v1.md` §4-§5).
 *
 * This is the single public schema of this unit: one `draftRichDescriptionSchema`
 * composed over the approved structural union (`./grammar`) that returns the
 * validated nullable description unchanged. It adds no derived read field, no
 * canonical bytes, no fingerprint and no new error class. Explicitly it is
 * **frontend prevalidation only**: the backend owns the authoritative plain
 * text, canonical bytes and budget.
 *
 * For a non-null description the order is:
 *   1. the complete structural grammar (done by the base schema) must pass;
 *   2. the approved plain-text derivation is reused, and its budget error is
 *      translated into a Zod issue;
 *   3. a bounded, conservative pre-encoding lower bound sums raw UTF-16 string
 *      units (keys included) so a huge non-plain payload — for example
 *      aggregated `link` attributes — aborts before the encoder materializes
 *      it;
 *   4. the complete validated envelope is encoded with the approved
 *      `encodeGoJsonV1`, and its actual byte length is the final inclusive
 *      65536 limit.
 * `null` returns `null` and never derives, measures or encodes.
 *
 * Every rejection is expressed as a Zod issue discriminated by `params.kind`
 * (`plain_budget`, `canonical_budget`, `encoding`); a known encoder rejection
 * additionally carries `params.goJsonV1Code`. Unexpected exceptions are never
 * swallowed: only the two known error classes are caught. This is not a
 * hostile-`Proxy` sandbox; it validates ordinary JSON-shaped draft data.
 */

/** Inclusive canonical `go-json-v1` byte budget for the complete envelope. */
const DRAFT_DESCRIPTION_CANONICAL_MAX_BYTES = 65536;

/** Machine-readable Zod issue discriminators for the three rejection classes. */
const PLAIN_BUDGET_KIND = "plain_budget";
const CANONICAL_BUDGET_KIND = "canonical_budget";
const ENCODING_KIND = "encoding";

/**
 * Conservative pre-encoding lower bound: the number of raw UTF-16 string units
 * across the already-validated description, object keys included.
 *
 * Every UTF-8 string byte costs at least one UTF-16 unit, and the canonical
 * envelope quotes every string and key it carries, so this sum is always less
 * than or equal to the canonical byte length: a sum above 65536 proves the
 * canonical bytes are above 65536 without running the encoder. Only string
 * units are added — no structural overhead, no escape engine and no
 * duplicated `go-json-v1` logic. Traversal recurses over the validated value,
 * which the grammar already bounds (depth ≤ 16, ≤ 2000 nodes), and stops at the
 * first excess, so a wide child set is never materialized into a pending-frame
 * stack.
 */
const exceedsStringUnitLowerBound = (description: DraftRichDescription): boolean => {
  let units = 0;
  let exceeded = false;

  const visit = (value: unknown): void => {
    if (exceeded) return;
    if (typeof value === "string") {
      units += value.length;
      if (units > DRAFT_DESCRIPTION_CANONICAL_MAX_BYTES) exceeded = true;
      return;
    }
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        visit(value[index]);
        if (exceeded) return;
      }
      return;
    }
    if (value !== null && typeof value === "object") {
      const record = value as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        units += key.length;
        if (units > DRAFT_DESCRIPTION_CANONICAL_MAX_BYTES) {
          exceeded = true;
          return;
        }
        visit(record[key]);
        if (exceeded) return;
      }
    }
  };

  visit(description);
  return exceeded;
};

/**
 * `description`: `null`, or a version-1 envelope whose complete document passes
 * the structural grammar, the approved plain-text budget and the canonical
 * `go-json-v1` byte budget. Returns the validated description unchanged.
 */
export const draftRichDescriptionSchema = draftRichDescriptionStructureSchema.superRefine(
  (description, context) => {
    if (description === null) return;

    try {
      deriveDraftDescriptionPlain(description);
    } catch (error) {
      if (error instanceof DraftDescriptionPlainBudgetError) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `description plain text exceeds ${DRAFT_DESCRIPTION_PLAIN_MAX_BYTES} UTF-8 bytes`,
          params: { kind: PLAIN_BUDGET_KIND },
        });
        return;
      }
      throw error;
    }

    if (exceedsStringUnitLowerBound(description)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `description canonical go-json-v1 bytes exceed ${DRAFT_DESCRIPTION_CANONICAL_MAX_BYTES}`,
        params: { kind: CANONICAL_BUDGET_KIND },
      });
      return;
    }

    let bytes: Uint8Array;
    try {
      bytes = encodeGoJsonV1(description);
    } catch (error) {
      if (error instanceof GoJsonV1EncodeError) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `description is not encodable as go-json-v1 (${error.code})`,
          params: { kind: ENCODING_KIND, goJsonV1Code: error.code },
        });
        return;
      }
      throw error;
    }

    if (bytes.byteLength > DRAFT_DESCRIPTION_CANONICAL_MAX_BYTES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `description canonical go-json-v1 bytes exceed ${DRAFT_DESCRIPTION_CANONICAL_MAX_BYTES}`,
        params: { kind: CANONICAL_BUDGET_KIND },
      });
    }
  },
);

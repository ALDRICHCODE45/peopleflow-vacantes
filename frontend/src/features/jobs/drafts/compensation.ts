import { z } from "zod";

/**
 * `fields.compensation` value object for the private vacancy draft slice
 * (`docs/contracts/private-vacancy-drafts-v1.md` §4.6).
 *
 * Zod-only: no React, no transport, no server-only import, so the draft form
 * and the eventual draft client can reuse one validation source. The rules here
 * mirror the accepted design; they are not a claim that the backend enforces
 * them yet, so a future backend unit must revalidate every one.
 */

/** Accepted `mode` literals; `null` (no mode selected) is allowed. */
export const COMPENSATION_MODES = ["fixed", "range"] as const;
/** Accepted `currency` literals; `null` is allowed. */
export const COMPENSATION_CURRENCIES = ["MXN", "USD"] as const;
/** Accepted `pay_period` literals; `quincenal` is `semimonthly`, not biweekly. */
export const COMPENSATION_PAY_PERIODS = [
  "hourly",
  "weekly",
  "semimonthly",
  "monthly",
  "yearly",
] as const;
/** Accepted `basis` literals; `null` is allowed. */
export const COMPENSATION_BASES = ["gross", "net"] as const;

/**
 * Accepted money syntax (§4.6): `0`..`999999999999` with at most two decimals.
 * Anchored, so surrounding ASCII or Unicode whitespace, signs, exponents,
 * commas and excess precision are rejected instead of being trimmed or rounded.
 */
export const COMPENSATION_MONEY_PATTERN = /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$/;

/**
 * Formats one regex-accepted money string to exactly two decimals using string
 * operations only, so no IEEE-754 conversion can round or drop a digit.
 */
export function normalizeCompensationMoney(value: string): string {
  const [integer, fraction = ""] = value.split(".");
  return `${integer}.${(fraction + "00").slice(0, 2)}`;
}

/**
 * Exact comparison of two normalized non-negative money strings: integer part
 * by digit count then lexicographically, fraction lexicographically. Never
 * routes through `Number`, so 12-digit amounts stay exact.
 */
function compareNormalizedMoney(left: string, right: string): number {
  const [leftInteger, leftFraction] = left.split(".");
  const [rightInteger, rightFraction] = right.split(".");
  if (leftInteger.length !== rightInteger.length) {
    return leftInteger.length < rightInteger.length ? -1 : 1;
  }
  if (leftInteger !== rightInteger) return leftInteger < rightInteger ? -1 : 1;
  if (leftFraction === rightFraction) return 0;
  return leftFraction < rightFraction ? -1 : 1;
}

/** One nullable money field: syntax-checked, then normalized at parse time. */
const money = z
  .string()
  .regex(COMPENSATION_MONEY_PATTERN, "invalid compensation amount")
  .transform(normalizeCompensationMoney)
  .nullable();

/**
 * Strict, complete write-shape for `fields.compensation`. A whole `null`
 * object, a missing key or an unknown key is rejected; every declared key is
 * required and `public_visible` is a literal boolean. Conditional mode rules
 * and the `min <= max` check run only when the relevant values are non-null.
 */
export const compensationSchema = z
  .object({
    mode: z.enum(COMPENSATION_MODES).nullable(),
    amount: money,
    min: money,
    max: money,
    currency: z.enum(COMPENSATION_CURRENCIES).nullable(),
    pay_period: z.enum(COMPENSATION_PAY_PERIODS).nullable(),
    basis: z.enum(COMPENSATION_BASES).nullable(),
    public_visible: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    const invalid = (path: "amount" | "min" | "max", message: string) =>
      context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (value.mode === null) {
      if (value.amount !== null) invalid("amount", "amount requires a compensation mode");
      if (value.min !== null) invalid("min", "min requires a compensation mode");
      if (value.max !== null) invalid("max", "max requires a compensation mode");
      return;
    }
    if (value.mode === "fixed") {
      if (value.min !== null) invalid("min", "fixed mode does not accept min");
      if (value.max !== null) invalid("max", "fixed mode does not accept max");
      return;
    }
    if (value.amount !== null) invalid("amount", "range mode does not accept amount");
    if (
      value.min !== null &&
      value.max !== null &&
      compareNormalizedMoney(value.min, value.max) > 0
    ) {
      invalid("max", "max must be greater than or equal to min");
    }
  });

/** Exact input accepted on the wire: nullable draft fields with raw money strings. */
export type CompensationInput = z.input<typeof compensationSchema>;
/** Normalized value: accepted money always emitted with exactly two decimals. */
export type Compensation = z.output<typeof compensationSchema>;

/**
 * Fresh `POST` default for an omitted `compensation` object (§4.6). A factory,
 * not `schema.default(...)` and not a PATCH merge, so every call owns a distinct
 * mutable object; the caller still chooses to omit it from a POST.
 */
export function createCompensationDefaults(): Compensation {
  return {
    mode: null,
    amount: null,
    min: null,
    max: null,
    currency: "MXN",
    pay_period: "monthly",
    basis: null,
    public_visible: false,
  };
}

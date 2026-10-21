import type { PublicJobDetail } from "./types";
import type { JobsQuery } from "./url";

type PublicCompensation = PublicJobDetail["compensation"];

/**
 * The public salary rule (SAL-5..SAL-8), as `GET /v2/jobs` applies it. Without
 * an amount there is no salary filter and every vacancy stays eligible. With
 * one, only published compensation in the same currency, pay period and basis
 * is compared, without conversion: the offer `[lo, hi]` (a fixed amount is
 * `lo = hi`) matches when it reaches the requested minimum and starts at or
 * below the requested maximum, both inclusive and either side optional.
 * Expects a canonical query, whose amounts follow the money grammar.
 */
export function matchesSalaryFilter(compensation: PublicCompensation, query: JobsQuery): boolean {
  const { salary_min: min, salary_max: max } = query;
  if (min === undefined && max === undefined) return true;
  if (compensation === null) return false;
  if (compensation.currency !== query.salary_currency || compensation.pay_period !== query.salary_period || compensation.basis !== query.salary_basis) return false;
  const low = Number(compensation.mode === "fixed" ? compensation.amount : compensation.min);
  const high = Number(compensation.mode === "fixed" ? compensation.amount : compensation.max);
  return (min === undefined || high >= Number(min)) && (max === undefined || low <= Number(max));
}

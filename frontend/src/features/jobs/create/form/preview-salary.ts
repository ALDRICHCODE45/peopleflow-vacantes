import { formatPublicSalaryParts } from "../../formatters";
import type { PublicJobItem } from "../../types";

type Vacancy = Extract<PublicJobItem, { source: "vacancy" }>;
type Legacy = Extract<PublicJobItem, { source: "legacy" }>;
type SalaryProjection = Pick<Vacancy, "source" | "compensation"> | Pick<Legacy, "source" | "legacy_salary">;

/**
 * Read-only salary projection for local previews. The public formatter reads only
 * these fields; keep the type bridge here rather than inventing a complete job
 * (company, publication, etc.) that the local editor does not have.
 */
export function previewSalaryParts(value: SalaryProjection) {
  return formatPublicSalaryParts(value as PublicJobItem);
}

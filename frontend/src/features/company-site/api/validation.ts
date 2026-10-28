import type { ZodIssue } from "zod";
import type { FieldError } from "./model";

const wirePath = (path: (string | number)[]) => path.reduce<string>((field, part) =>
  typeof part === "number" ? `${field}[${part}]` : `${field}${field ? "." : ""}${part}`, "");

/** Preserve backend field paths; rich/media internals belong to one editor control. */
function fieldPath(issue: ZodIssue): string {
  const path = issue.path;
  if (path[0] !== "blocks") return wirePath(path) || "blocks";
  if (typeof path[1] !== "number") return "blocks";
  const block = path.slice(0, 2);
  if (issue.code === "unrecognized_keys" || path[2] !== "content" || typeof path[3] !== "string") return wirePath(block);
  if (path[3] === "items") {
    if (typeof path[4] !== "number" || typeof path[5] !== "string") return wirePath(block);
    return wirePath(path.slice(0, 6));
  }
  return wirePath(path.slice(0, 4));
}
function fieldCode(issue: ZodIssue): FieldError["code"] {
  if (issue.code === "too_big") return "too_long";
  if (issue.code === "unrecognized_keys") return "unknown_key";
  if (issue.code === "invalid_type" && issue.received === "undefined") return "required";
  if (issue.code === "custom") {
    if (/^Maximum \d+/.test(issue.message) || ["plain_budget", "canonical_budget"].includes(issue.params?.kind)) return "too_long";
    if (issue.message === "Duplicate block id") return "duplicate";
    if (issue.message === "Required block cannot be hidden") return "not_allowed";
  }
  return "invalid";
}
export function draftFieldErrors(issues: ZodIssue[]): FieldError[] {
  const fields = issues.map(issue => ({ field: fieldPath(issue), code: fieldCode(issue) }));
  return fields.filter((error, index) => fields.findIndex(other => other.field === error.field && other.code === error.code) === index);
}

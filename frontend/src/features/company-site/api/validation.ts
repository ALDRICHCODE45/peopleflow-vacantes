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
  // §2.3: an unknown key inside the style is reported on `style.<key>`.
  if (issue.code === "unrecognized_keys" && path[2] === "style" && path.length === 3) return wirePath([...path, issue.keys[0]]);
  if (issue.code === "unrecognized_keys") return wirePath(block);
  // Sections v2: each «Estilo de sección» control owns `style.<key>`; a refusal of the
  // whole style (flag off) stays on `style`.
  if (path[2] === "style") return wirePath(path.slice(0, typeof path[3] === "string" ? 4 : 3));
  if (path[2] !== "content" || typeof path[3] !== "string") return wirePath(block);
  // Item collections (items, area overrides) map to one item field.
  if (path[3] === "items" || path[3] === "overrides") {
    if (typeof path[4] !== "number" || typeof path[5] !== "string") return path[3] === "items" ? wirePath(block) : wirePath(path.slice(0, 4));
    return wirePath(path.slice(0, 6));
  }
  // Hero collage: one media slot per image.
  if (path[3] === "images" && typeof path[4] === "number") return wirePath(path.slice(0, 5));
  return wirePath(path.slice(0, 4));
}
function fieldCode(issue: ZodIssue): FieldError["code"] {
  if (issue.code === "too_big") return "too_long";
  if (issue.code === "unrecognized_keys") return "unknown_key";
  if (issue.code === "invalid_type" && issue.received === "undefined") return "required";
  if (issue.code === "custom") {
    if (["required", "not_allowed", "invalid", "too_long", "duplicate"].includes(issue.params?.wireCode)) return issue.params!.wireCode as FieldError["code"];
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

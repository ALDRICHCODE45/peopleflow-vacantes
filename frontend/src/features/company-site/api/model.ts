import { z } from "zod";
import { siteDraftSchema } from "../model";

const version = z.number().int().positive().safe();
const timestamp = z.string().datetime({ offset: true });
export const mediaSchema = z.object({ id: z.string().uuid(), kind: z.enum(["cover", "gallery", "portrait", "story"]), url: z.string().min(1), width: z.number().int().positive(), height: z.number().int().positive() });
export const siteStateSchema = z.object({
  draft: siteDraftSchema, draft_version: version,
  published: z.object({ version, slug: z.string().min(1), published_at: timestamp }).nullable(),
  has_unpublished_changes: z.boolean(), media: z.array(mediaSchema), updated_at: timestamp,
});
export type SiteState = z.infer<typeof siteStateSchema>;
export const fieldErrorSchema = z.object({ field: z.string().min(1), code: z.enum(["too_long", "required", "invalid", "unknown_key", "duplicate", "not_allowed"]) });
export type FieldError = z.infer<typeof fieldErrorSchema>;
const base = { error: z.string().min(1) };
export const errorSchema = z.discriminatedUnion("code", [
  z.object({ ...base, code: z.literal("version_conflict"), current: siteStateSchema }),
  z.object({ ...base, code: z.literal("validation_error"), fields: z.array(fieldErrorSchema) }),
  z.object({ ...base, code: z.literal("slug_taken"), field: z.literal("slug") }),
  z.object({ ...base, code: z.literal("slug_reserved"), field: z.literal("slug") }),
  z.object({ ...base, code: z.literal("publish_blocked"), issues: z.array(z.object({ code: z.enum(["slug_missing", "hero_title_missing", "no_content_block", "block_incomplete", "company_logo_missing", "company_name_missing"]), field: z.string().nullable() })) }),
  ...(["invalid_request", "forbidden", "company_inactive", "precondition_required", "payload_too_large", "unsupported_media_type", "image_too_small", "image_too_large", "media_limit_reached"] as const).map(code => z.object({ ...base, code: z.literal(code) })),
]);
export type SiteError = z.infer<typeof errorSchema>;
export type Failure = { kind: "conflict"; current: SiteState } | { kind: "invalid"; fields: FieldError[] } | { kind: "error"; code: SiteError["code"]; issues?: Extract<SiteError, { code: "publish_blocked" }>["issues"]; field?: "slug" } | { kind: "uncertain" | "unrecognized" | "unauthenticated" | "invalid_request" };
export type SiteResult = { kind: "success"; data: SiteState; etag: string } | Failure;
export const availabilitySchema = z.object({ slug: z.string(), available: z.boolean(), reason: z.enum(["taken", "reserved", "invalid"]).nullable() });
export type AvailabilityResult = { kind: "success"; data: z.infer<typeof availabilitySchema> } | Failure;
export const errorStatuses: Record<SiteError["code"], number> = {
  invalid_request: 400, version_conflict: 412, validation_error: 400, slug_taken: 409, slug_reserved: 422, publish_blocked: 422,
  forbidden: 403, company_inactive: 403, precondition_required: 428, payload_too_large: 413,
  unsupported_media_type: 415, image_too_small: 422, image_too_large: 422, media_limit_reached: 422,
};
export function decodeFailure(status: number, value: unknown): Failure {
  // Authentication is an HTTP gate even when the upstream body is absent or invalid.
  if (status === 401) return { kind: "unauthenticated" };
  const parsed = errorSchema.safeParse(value);
  if (!parsed.success || errorStatuses[parsed.data.code] !== status) return { kind: "unrecognized" };
  const error = parsed.data;
  if (error.code === "version_conflict") return { kind: "conflict", current: error.current };
  if (error.code === "validation_error") return { kind: "invalid", fields: error.fields };
  return { kind: "error", code: error.code, ...("issues" in error ? { issues: error.issues } : {}), ...("field" in error ? { field: error.field } : {}) };
}
/** Restrict upload failures to the media endpoint's documented status/code pairs. */
export function decodeMediaError(status: number, value: unknown): Failure {
  if (status === 401) return { kind: "unauthenticated" };
  const parsed = errorSchema.safeParse(value);
  if (!parsed.success || !["invalid_request", "payload_too_large", "unsupported_media_type", "image_too_small", "image_too_large", "media_limit_reached", "forbidden", "company_inactive"].includes(parsed.data.code)) return { kind: "unrecognized" };
  return decodeFailure(status, parsed.data);
}

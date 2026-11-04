import { z } from "zod";

export const TALENT_BASE_MODES = ["all_recruiters", "selected_users"] as const;
export type TalentBaseMode = (typeof TALENT_BASE_MODES)[number];

const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });

/** GET/PUT document of `docs/contracts/talent-base-visibility-v1.md`. */
export const talentBaseVisibilitySchema = z.object({
  mode: z.enum(TALENT_BASE_MODES),
  viewers: z.array(z.object({ user_id: uuid, full_name: z.string(), email: z.string(), role: z.enum(["owner", "recruiter"]), added_at: timestamp }).strict()),
  version: z.number().int().min(1),
  /** null (like updated_by) while the owner has never saved the setting: all_recruiters, version 1, ETag "1". */
  updated_at: timestamp.nullable(),
  updated_by: z.object({ user_id: uuid, full_name: z.string() }).strict().nullable(),
}).strict();
export type TalentBaseVisibility = z.infer<typeof talentBaseVisibilitySchema>;

/** The PUT body replaces the setting; `user_ids` must be empty unless `selected_users`. */
export const talentBaseVisibilityBodySchema = z.object({ mode: z.enum(TALENT_BASE_MODES), user_ids: z.array(uuid) }).strict();
export type TalentBaseVisibilityBody = z.infer<typeof talentBaseVisibilityBodySchema>;

export const talentBaseErrorEnvelopeSchema = z.object({
  error: z.string(), code: z.string(),
  fields: z.array(z.object({ field: z.string(), code: z.string() })).optional(),
});

/** ETags are strong quoted integers (`"3"`), so the document version is the precondition. */
export const etagForVersion = (version: number) => `"${version}"`;

export type TalentBaseFailureReason =
  | "unauthenticated" | "forbidden" | "version_conflict" | "validation_error" | "users_not_applicable"
  | "viewer_not_member" | "viewer_is_owner" | "invalid_request" | "server_error" | "no_response" | "unrecognized_response";
export type TalentBaseFailure = {
  ok: false;
  reason: TalentBaseFailureReason;
  reference: { status?: number; code?: string };
  /** Current document, present on a version conflict. */
  document?: TalentBaseVisibility;
  /** Contract field paths without indexes (`mode`, `user_ids`) reported by validation_error. */
  fields?: string[];
  /** Submitted user ids the backend flagged through `user_ids[i]`. */
  userIds?: string[];
};
export type TalentBaseLoadResult = { ok: true; document: TalentBaseVisibility } | TalentBaseFailure;
export type TalentBaseSaveResult = { ok: true; document: TalentBaseVisibility } | TalentBaseFailure;

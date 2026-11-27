import { z } from "zod";

/** Decoders for backend `docs/contracts/notifications-v1.md` (agreed 80a5ce80), company inbox read side (N4). */
const uuid = z.string().uuid();
const text = z.string().min(1);
const timestamp = z.string().datetime({ offset: true });
const count = z.number().int().nonnegative().safe();

/** The 14 stage-1 types. The decoder keeps `type` open: a type added later must render generically, never fail. */
export const NOTIFICATION_TYPES = [
  "application_received", "delivery_due_soon", "delivery_overdue", "assignment_deadline_due_soon", "assignment_deadline_overdue",
  "vacancy_assigned", "vacancy_reassigned", "vacancy_unassigned", "vacancy_team_added",
  "psychometric_completed", "psychometric_pending", "candidate_status_changed", "candidate_message_received", "candidate_test_pending",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export const isKnownNotificationType = (type: string): type is NotificationType => (NOTIFICATION_TYPES as readonly string[]).includes(type);

/**
 * Whose inbox: members on `/v2/me/company/notifications`, candidates on `/v2/me/notifications` (L14). A closed enum —
 * the server maps it to a fixed path; the browser never sends a path.
 */
export const NOTIFICATION_SCOPES = ["company", "candidate"] as const;
export type NotificationScope = (typeof NOTIFICATION_SCOPES)[number];

export const NOTIFICATION_STATES = ["all", "unread"] as const;
export type NotificationState = (typeof NOTIFICATION_STATES)[number];

const userRef = z.object({ user_id: uuid, name: z.string().nullable() });

/** Deep-link target. A kind this build cannot route, or a malformed link, becomes null instead of failing the page. */
export const notificationLinkSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("vacancy"), job_id: uuid }),
  z.object({ kind: z.literal("vacancy_candidates"), job_id: uuid }),
  z.object({ kind: z.literal("vacancy_delivery"), job_id: uuid }),
  z.object({ kind: z.literal("participation"), job_id: uuid, participation_id: uuid }),
  z.object({ kind: z.literal("application"), job_id: uuid, participation_id: uuid }),
  z.object({ kind: z.literal("assessment"), invitation_id: uuid }),
]);

/** Non-strict objects: fields added later by the backend are stripped, never a decode failure. */
export const notificationGroupSchema = z.object({
  group_key: text,
  type: text,
  kind: z.enum(["mandatory", "operational", "informative"]),
  urgency: z.enum(["normal", "due_soon", "overdue"]),
  count: count,
  unread_count: count,
  read: z.boolean(),
  resolved: z.boolean(),
  latest_at: timestamp,
  first_at: timestamp,
  job: z.object({ id: uuid, title: z.string().nullable() }).nullable(),
  latest: z.object({ id: text, created_at: timestamp, actor: userRef.nullable(), payload: z.record(z.unknown()) }),
  sample: z.array(z.object({ participation_id: uuid, name: z.string().nullable() })).max(3),
  link: notificationLinkSchema.nullable().catch(null),
  // Omitted (not null) when the payload carries no user id (L12).
  from_user: userRef.optional(),
  to_user: userRef.optional(),
  // Candidate side only (L14): null when the vacancy can no longer be resolved; absent on member items.
  company: z.object({ id: uuid, name: z.string() }).nullable().optional(),
});

/** With a cursor, `attention` and `attention_total` are null (L12). */
export const notificationPageSchema = z.object({
  attention: z.array(notificationGroupSchema).max(20).nullable(),
  attention_total: count.nullable(),
  items: z.array(notificationGroupSchema).max(50),
  next_cursor: z.string().nullable(),
  unread_count: count,
  unread_notifications: count,
});

export const unreadCountSchema = z.object({ unread_count: count, unread_notifications: count });

/** Answer of `POST …/read`, `…/unread` and `…/read-all` (N5). `marked_at` is what «Deshacer» sends back to `…/unread`. */
export const markResultSchema = z.object({
  affected_notifications: count,
  affected_groups: count,
  marked_at: timestamp,
  unread_count: count,
  unread_notifications: count,
});

/** `GET …/facets`: group counts per type (open string) and per job (≤ 50, `jobs_total` = distinct jobs). */
export const facetsSchema = z.object({
  state: z.enum(NOTIFICATION_STATES),
  types: z.array(z.object({ type: text, count })),
  jobs: z.array(z.object({ job_id: uuid, title: z.string().nullable(), count })).max(50),
  jobs_total: count,
});

/** Flat error envelope; leniently decoded, never shown verbatim. `data.types` rides on 422 `notification_preference_locked`. */
export const errorEnvelopeSchema = z.object({
  error: text, code: text,
  fields: z.array(z.object({ field: text, code: text })).optional(),
  data: z.object({ types: z.array(z.unknown()) }).optional().catch(undefined),
});

/*
 * Personal preferences, backend `docs/contracts/notifications-v2.md` (agreed 07bd4d5a, E2 / L21). The catalog lists
 * every type of the caller's tree (members 11, candidates 3) with both channels; `type` and `kind` stay open strings so
 * a type added later is kept and labelled generically.
 */
export const NOTIFICATION_CHANNELS = ["in_app", "email"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
/** PUT limit: 1–28 entries (14 types × 2 channels). */
export const MAX_PREFERENCE_ENTRIES = 28;
/** Backend type names are snake_case enums; anything else is refused locally and dropped from `data.types`. */
export const PREFERENCE_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

const preferenceChannelSchema = z.object({ default: z.boolean(), enabled: z.boolean(), mandatory_locked: z.boolean() });
export const preferenceItemSchema = z.object({
  type: text,
  kind: text,
  channels: z.object({ in_app: preferenceChannelSchema, email: preferenceChannelSchema }),
});
export const preferencesSchema = z.object({
  channels: z.array(text),
  email_deliverable: z.boolean(),
  items: z.array(preferenceItemSchema),
});
export type PreferenceChannelState = z.infer<typeof preferenceChannelSchema>;
export type PreferenceItem = z.infer<typeof preferenceItemSchema>;
export type NotificationPreferences = z.infer<typeof preferencesSchema>;
/** One PUT entry; the body is `{preferences: PreferenceEntry[]}`. */
export type PreferenceEntry = { type: string; channel: NotificationChannel; enabled: boolean };

export type NotificationLink = z.infer<typeof notificationLinkSchema>;
export type NotificationGroup = z.infer<typeof notificationGroupSchema>;
export type NotificationPage = z.infer<typeof notificationPageSchema>;
export type UnreadCount = z.infer<typeof unreadCountSchema>;
export type NotificationErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
export type MarkResult = z.infer<typeof markResultSchema>;
export type NotificationFacets = z.infer<typeof facetsSchema>;
export type FilterIssue = { field: string; code: string };

/** Body issue codes of 400 `validation_error` (L13; `duplicate` from preferences, L21); anything else from the backend is dropped. */
export const VALIDATION_CODES = ["required", "invalid", "not_allowed", "empty", "too_many", "duplicate"] as const;
export const VALIDATION_FIELDS = ["body", "group_keys", "ids", "marked_at", "types", "job_ids", "before"] as const;
/** Preference fields (L21): `preferences`, `preferences[i]`, `preferences[i].type|channel|enabled`. */
export const PREFERENCE_FIELD_PATTERN = /^preferences(?:\[\d{1,2}\](?:\.(?:type|channel|enabled))?)?$/;

/** Exactly one selection. `markedAt` (undo of an earlier mark) is accepted by unread only. */
export type MarkTarget = { groupKeys: readonly string[] } | { ids: readonly string[] };
export type UnmarkTarget = MarkTarget | { markedAt: string };
export type MarkAllInput = { types?: readonly NotificationType[]; jobIds?: readonly string[]; before?: string };

/*
 * Email unsubscribe (contract v2 E7 / L23): `GET|POST /v2/notifications/unsubscribe?token=…` answer the link's type, the
 * email channel, its current state (`enabled`; false after POST) and the company (null for candidates).
 */
export const unsubscribeStateSchema = z.object({
  type: text,
  channel: z.literal("email"),
  enabled: z.boolean(),
  company: z.object({ id: text, name: text }).nullable(),
});
export type UnsubscribeState = z.infer<typeof unsubscribeStateSchema>;

export type NotificationFailure = {
  ok: false;
  reason:
    | "unauthenticated" | "forbidden" | "invalid_filter" | "invalid_cursor" | "validation_error"
    | "server_error" | "no_response" | "unrecognized_response" | "preference_locked"
    | "unsubscribe_link_invalid" | "rate_limited";
  fields?: FilterIssue[];
  /** `preference_locked` only: the mandatory types the entries targeted (422 `data.types`, or found locally). */
  lockedTypes?: string[];
  /** `rate_limited` only: the backend's Retry-After (delta seconds or HTTP date), when well formed. */
  retryAfter?: string;
  reference: { status?: number; code?: string };
};
export type NotificationListResult = { ok: true; data: NotificationPage } | NotificationFailure;
export type UnreadCountResult = { ok: true; data: UnreadCount } | NotificationFailure;
export type MarkResultResult = { ok: true; data: MarkResult } | NotificationFailure;
export type FacetsResult = { ok: true; data: NotificationFacets } | NotificationFailure;
export type PreferencesResult = { ok: true; data: NotificationPreferences } | NotificationFailure;
export type UnsubscribeResult = { ok: true; data: UnsubscribeState } | NotificationFailure;

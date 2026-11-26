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
  // Candidate side only.
  company: z.object({ id: uuid, name: z.string() }).optional(),
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

/** Flat error envelope; leniently decoded, never shown verbatim. */
export const errorEnvelopeSchema = z.object({
  error: text, code: text,
  fields: z.array(z.object({ field: text, code: text })).optional(),
});

export type NotificationLink = z.infer<typeof notificationLinkSchema>;
export type NotificationGroup = z.infer<typeof notificationGroupSchema>;
export type NotificationPage = z.infer<typeof notificationPageSchema>;
export type UnreadCount = z.infer<typeof unreadCountSchema>;
export type NotificationErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
export type FilterIssue = { field: string; code: string };

export type NotificationFailure = {
  ok: false;
  reason: "unauthenticated" | "forbidden" | "invalid_filter" | "invalid_cursor" | "server_error" | "no_response" | "unrecognized_response";
  fields?: FilterIssue[];
  reference: { status?: number; code?: string };
};
export type NotificationListResult = { ok: true; data: NotificationPage } | NotificationFailure;
export type UnreadCountResult = { ok: true; data: UnreadCount } | NotificationFailure;

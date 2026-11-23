import { z } from "zod";
import { lifecycleSchema, startReplacementBlockerSchema, type StartReplacementBlocker } from "@/features/vacancy-lifecycle/model";
import type { Delivery } from "@/features/jobs/drafts/pipeline/delivery-model";
import { discardReasonSchema } from "@/features/pipeline-movement/model";

/**
 * replacement-processes-v1 «GET V/replacements» and «POST V/replacements». Pure schemas (no `server-only`): shared by the
 * server client, the actions and the dialog. Read views are non-strict on purpose: the contract lets informative keys grow.
 */
const id = z.string().uuid();
const text = z.string().min(1);
export const candidateKindSchema = z.enum(["manual", "organic"]);
export type CandidateKind = z.infer<typeof candidateKindSchema>;
const person = z.object({ id: z.string(), name: z.string() });

export const startableCreditSchema = z.object({
  credit_id: id, process_id: id, participation_id: id,
  candidate: z.object({ kind: candidateKindSchema, id, full_name: text }),
  hired_at: z.string().nullable(), left_at: z.string().nullable(), exit_reason: z.string().nullable().optional(),
  recipients: z.array(z.object({ user_id: id, name: z.string(), kind: z.string() })).optional(),
});
export type StartableCredit = z.infer<typeof startableCreditSchema>;

export const carryCandidateSchema = z.object({
  candidate: z.object({ kind: candidateKindSchema, id, full_name: text }),
  process_id: id, participation_id: id,
  /** Previous stage by `kind` and `name` only: its id belongs to another process of the chain. */
  stage: z.object({ kind: text, name: text }),
  discarded: z.boolean(), eligible: z.boolean(), reason: z.string().optional(),
  /** R5: the board's `discard.reason` while `discarded`, else `null`. Absent before R5; a malformed one reads as absent, never as a broken read. */
  discard_reason: discardReasonSchema.nullable().optional().catch(undefined),
});
export type CarryCandidate = z.infer<typeof carryCandidateSchema>;

/** R4b: every credit that fell («did_not_hold») in the chain, whether or not it can be replaced now; the board keeps the badge from it. */
export const fallenCreditSchema = z.object({
  id, participation_id: id, process_id: id.optional(),
  left_at: z.string().nullable().optional(),
  /** Only the name is read (link bar: «Reemplaza a …»); a missing or malformed candidate reads as «unnamed», never as a broken read. */
  candidate: z.object({ full_name: text }).optional().catch(undefined),
  status: z.enum(["replaced", "startable", "blocked"]),
  replaced_by_process_id: id.optional(), blocker: startReplacementBlockerSchema.optional(),
});
export type FallenCredit = z.infer<typeof fallenCreditSchema>;

/** `sequence` is 0 for the original and 1… for each replacement (the lifecycle view keeps `null` for an original; this list does not). */
const chainItemSchema = z.object({
  id, kind: z.enum(["original", "replacement"]), sequence: z.number().int().nonnegative(), replacement_of: id.nullable(),
  title: z.string(), visibility: z.string().nullable(),
  lifecycle: z.object({ publication: z.string().nullable(), process: z.string().nullable(), close_reason: z.string().nullable().optional(), closed_at: z.string().nullable().optional() }),
  started_at: z.string().nullable(), started_by: person.nullable(),
  coverage: z.object({ covered: z.number().int().nonnegative(), required: z.number().int().nonnegative().nullable() }),
  replaced_credit_ids: z.array(id), can_open: z.boolean(),
});

export const replacementsViewSchema = z.object({
  root_process_id: id,
  items: z.array(chainItemSchema),
  start_replacement: z.object({
    allowed: z.boolean(), blocker: startReplacementBlockerSchema.nullable(), active_replacement_id: id.nullable(),
    startable_credits: z.array(startableCreditSchema),
    /** `null` while `allowed` is false. */
    publish_ready: z.boolean().nullable(), missing: z.array(z.string()),
  }),
  carry_candidates: z.array(carryCandidateSchema),
  carry_candidates_truncated: z.boolean(),
  /** Absent before R4b (an older backend): then the board only knows the startable credits. A malformed list never breaks the start dialog: it reads as absent. */
  fallen_credits: z.array(fallenCreditSchema).optional().catch(undefined),
});
export type ReplacementsView = z.infer<typeof replacementsViewSchema>;

/**
 * What the board keeps of one `GET V/replacements` (it has no ETag and may carry up to 1000 carry candidates, which the board does not need):
 * the chain names for the link bar and the startable credits to resolve the departed cards by `participation_id`.
 * The credits are only filled by the backend while `start_replacement.allowed`.
 */
export type ChainSummary = {
  /** `replaces`: names of the departed hires the process covers; only present when the backend sends the fallen credits with their candidate. */
  items: { id: string; kind: "original" | "replacement"; sequence: number; title: string; canOpen: boolean; replaces?: string[] }[];
  credits: { id: string; participationId: string; hiredAt: string | null; leftAt: string | null }[];
  /** Every fallen credit of the chain by participation; `undefined` while the backend does not send them (R4b). */
  fallen?: { id: string; participationId: string; leftAt: string | null; status: FallenCredit["status"]; replacedBy: string | null }[];
};
export function summarizeReplacements(view: ReplacementsView): ChainSummary {
  const nameOf = new Map((view.fallen_credits ?? []).flatMap(credit => credit.candidate ? [[credit.id, credit.candidate.full_name] as const] : []));
  return {
    items: view.items.map(item => {
      const replaces = item.replaced_credit_ids.flatMap(creditId => nameOf.get(creditId) ?? []);
      return { id: item.id, kind: item.kind, sequence: item.sequence, title: item.title, canOpen: item.can_open, ...(replaces.length ? { replaces } : {}) };
    }),
    credits: view.start_replacement.startable_credits.map(credit => ({ id: credit.credit_id, participationId: credit.participation_id, hiredAt: credit.hired_at, leftAt: credit.left_at })),
    ...(view.fallen_credits ? { fallen: view.fallen_credits.map(credit => ({ id: credit.id, participationId: credit.participation_id, leftAt: credit.left_at ?? null, status: credit.status, replacedBy: credit.replaced_by_process_id ?? null })) } : {}),
  };
}
export type { StartReplacementBlocker };

export const MAX_BAJAS = 999;
export const MAX_CARRIED = 200;
const civilDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const startBodySchema = z.object({
  placement_credit_ids: z.array(id).min(1).max(MAX_BAJAS),
  responsible: z.object({ user_id: id }).strict().optional(),
  target_quantity: z.number().int().min(1).max(MAX_BAJAS).optional(),
  commitment_date: civilDate,
  publish: z.boolean().optional(),
  carried_candidates: z.array(z.object({ candidate: z.object({ kind: candidateKindSchema, id }).strict(), stage_id: id }).strict()).max(MAX_CARRIED).optional(),
}).strict()
  .refine(body => new Set(body.placement_credit_ids).size === body.placement_credit_ids.length, { path: ["placement_credit_ids"] })
  .refine(body => body.target_quantity === undefined || body.target_quantity >= body.placement_credit_ids.length, { path: ["target_quantity"] });
export type StartBody = z.infer<typeof startBodySchema>;

/** The 201 is decoded non-strictly: only `id`, `kind` and `lifecycle`; everything else in it is informative. */
export const startedSchema = z.object({ id, kind: z.literal("replacement"), lifecycle: lifecycleSchema });
export type Started = z.infer<typeof startedSchema>;

export type SourceStage = { id: string; kind: string; name: string };
export type StartContext = {
  replacements: ReplacementsView;
  /** The SOURCE's lifecycle ETag, sent as `If-Match`. */
  etag: string;
  members: { id: string; role: "owner" | "recruiter" | "stakeholder"; user: { id: string; full_name: string; email: string } }[];
  calendar: Delivery["calendar"];
};
export type UnavailableHire = { id: string; name: string; reason: "still_placed" | "already_replaced" };

export const candidateKey = (candidate: { kind: CandidateKind; id: string }) => `${candidate.kind}:${candidate.id}`;

/** Placement can only be reached by a later move, never as the starting stage of a carried candidate. */
export const startingStages = (stages: readonly SourceStage[]) => stages.filter(stage => stage.kind !== "placement");

/** Same kind and name first (custom stages share kind), then same name, then same kind; Placement falls back to the last stage before it. */
export function defaultStartingStage(stages: readonly SourceStage[], previous: { kind: string; name: string }): string {
  const allowed = startingStages(stages);
  const match = allowed.find(stage => stage.kind === previous.kind && stage.name === previous.name)
    ?? allowed.find(stage => stage.name === previous.name)
    ?? allowed.find(stage => stage.kind === previous.kind && stage.kind !== "custom");
  return (match ?? allowed[allowed.length - 1])?.id ?? "";
}

/** Whole business days after `today` up to and including `date`, skipping weekends and the calendar's non-business dates. */
export function businessDaysUntil(calendar: Pick<Delivery["calendar"], "today" | "nonBusinessDates">, date: string): number | null {
  const parse = (value: string) => { const [y, m, d] = value.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < calendar.today) return null;
  let count = 0;
  for (let time = parse(calendar.today) + 86_400_000, end = parse(date); time <= end; time += 86_400_000) {
    const day = new Date(time);
    const iso = day.toISOString().slice(0, 10);
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6 && !calendar.nonBusinessDates.includes(iso)) count += 1;
  }
  return count;
}

export const BLOCKER_COPY: Record<StartReplacementBlocker, string> = {
  source_not_closed: "Esta vacante aún no está cerrada. Ciérrala para iniciar un reemplazo.",
  not_latest: "Esta vacante ya tiene un proceso más reciente. Trabaja en ese proceso.",
  replacement_active: "Ya hay un reemplazo activo para esta vacante.",
  no_startable_credits: "No hay bajas pendientes de reemplazo. Marca «No se sostuvo» a quien se fue para iniciarlo.",
};

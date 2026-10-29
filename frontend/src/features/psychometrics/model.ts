import { z } from "zod";
export { validationFieldSchema } from "@/features/vacancy-checklist/model";
import type { ValidationField } from "@/features/vacancy-checklist/model";
export const COMPETENCY_IDS = ["comp.organizacion", "comp.compromisos", "comp.coordinacion", "comp.colaboracion", "comp.exploracion", "comp.deliberacion", "comp.presion"] as const;
export const FACET_IDS = ["facet.c2", "facet.c5", "facet.c3", "facet.c4", "facet.e3", "facet.e1", "facet.a3", "facet.a4", "facet.o4", "facet.o5", "facet.c6", "facet.e5", "facet.n1", "facet.n2", "facet.n6"] as const;
export const competencyIdSchema = z.enum(COMPETENCY_IDS);
export const facetIdSchema = z.enum(FACET_IDS);
export const bandSchema = z.enum(["band.low", "band.medium", "band.high"]);
export const importanceSchema = z.enum(["importance.clave", "importance.importante", "importance.no_relevante"]);
export const fitSchema = z.enum(["fit.alineado", "fit.explorar", "fit.atencion"]);
export const tierSchema = z.enum(["tier.sin", "tier.algunas", "tier.relevantes"]);
export const signalIdSchema = z.enum(["signal.attention", "signal.long_string", "signal.fast", "signal.changes"]);
export const uuidSchema = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const count = z.number().int().nonnegative().safe();
const counter = z.string().regex(/^(0|[1-9][0-9]*)$(?![\s\S])/);
const boundedText = (max: number) => z.string().trim().refine(s => [...s].length <= max, "too_long");
const unique = <T extends z.ZodTypeAny>(schema: T, key: (v: z.infer<T>) => string) => z.array(schema).refine(values => new Set(values.map(key)).size === values.length, "duplicate");
const catalog = <T extends z.ZodTypeAny>(schema: T, key: (v: z.infer<T>) => string, size: number) => z.array(schema).length(size).refine(values => new Set(values.map(key)).size === size, "duplicate");
const requirement = z.object({ competency_id: competencyIdSchema, importance: importanceSchema, desired_band: bandSchema.nullable(), rationale: boundedText(1000), task: boundedText(300).nullable() }).strict().refine(c => (c.importance === "importance.no_relevante") === (c.desired_band === null));
const profileBodyObject = z.object({ enabled: z.boolean(), test: z.literal("ipip60-mx"), confirmed: z.boolean(), competencies: catalog(requirement, c => c.competency_id, 7), auto_send_stage_ids: unique(uuidSchema, s => s.toLowerCase()), expires_in_days: z.number().int().min(1).max(30) }).strict();
const confirmationValid = (p: z.infer<typeof profileBodyObject>) => !p.confirmed || p.competencies.every(c => c.rationale.length > 0 && (c.importance !== "importance.clave" || !!c.task));
export const profileBodySchema = profileBodyObject.refine(confirmationValid);
export const profileSchema = profileBodyObject.extend({ version: counter, confirmed_at: timestamp.nullable() }).strict().refine(confirmationValid).refine(p => p.confirmed === (p.confirmed_at !== null));
const versions = { content_version: z.literal("psychometrics.content.v1"), scoring_version: z.literal("psychometrics.scoring.v1") };
export const invitationStatusSchema = z.enum(["created", "in_progress", "finished", "expired", "revoked"]);
export const invitationSchema = z.object({ id: uuidSchema, participation_id: uuidSchema, test: z.literal("ipip60-mx"), ...versions, status: invitationStatusSchema, origin: z.enum(["manual", "auto"]), created_by: z.object({ id: uuidSchema, full_name: z.string() }).strict().nullable(), trigger_stage_id: uuidSchema.nullable(), created_at: timestamp, expires_at: timestamp, consented_at: timestamp.nullable(), answered_count: count.max(63), total_count: z.literal(63), finished_at: timestamp.nullable(), last_reminded_at: timestamp.nullable(), reminder_count: count }).strict();
export const invitationsSchema = z.object({ items: z.array(invitationSchema) }).strict();
const competencyObject = z.object({ competency_id: competencyIdSchema, facet_ids: unique(facetIdSchema, s => s), oriented_sums: z.array(z.number().int().min(4).max(20)).min(2).max(3), oriented_sum: z.number().int().min(8).max(60), facet_count: z.number().int().min(2).max(3), index: z.string().regex(/^(?:[4-9]\.[0-9]|1[0-9]\.[0-9]|20\.0)$(?![\s\S])/), band: bandSchema }).strict();
const sumsValid = (c: z.infer<typeof competencyObject>) => c.facet_ids.length === c.facet_count && c.oriented_sums.length === c.facet_count && c.facet_count === (c.competency_id === "comp.presion" ? 3 : 2) && c.oriented_sum === c.oriented_sums.reduce((a, b) => a + b, 0);
export const competencySchema = competencyObject.refine(sumsValid);
export const comparedCompetencySchema = competencyObject.extend({ desired_band: bandSchema.nullable(), importance: importanceSchema, direction: z.enum(["below", "above"]).nullable(), fit: fitSchema.nullable() }).strict().refine(sumsValid);
export const focusAreaSchema = z.union([
  z.object({ type: z.enum(["focus.adjacent", "focus.distant"]), competency_id: competencyIdSchema, observed_band: bandSchema, desired_band: bandSchema, importance: z.enum(["importance.clave", "importance.importante"]), fit: fitSchema, profile_version: counter }).strict(),
  z.object({ type: z.literal("focus.quality"), competency_id: z.null(), tier: z.enum(["tier.algunas", "tier.relevantes"]), signal_ids: unique(signalIdSchema, s => s), routed_competency_id: competencyIdSchema }).strict(),
]);
const selectors = ["low", "medium", "high", "adjacent", "distant", "quality"] as const;
const bankId = (prefix: "lib" | "q") => z.string().refine(value => COMPETENCY_IDS.some(c => (prefix === "lib" ? ["low", "medium", "high"] : selectors).some(s => prefix === "lib" ? value === `lib.${c.slice(5)}.${s}` : [1, 2].some(n => value === `q.${c.slice(5)}.${s}.${n}`))));
export const guideQuestionSchema = z.object({ question_id: bankId("q"), competency_id: competencyIdSchema, text: z.string(), good_answer_checklist: z.string(), observed_band: bandSchema, desired_band: bandSchema.nullable(), importance: importanceSchema, fit: fitSchema.nullable(), selector: z.enum(selectors), originating_focus_type: z.enum(["focus.adjacent", "focus.distant", "focus.quality"]).nullable(), signal_ids: unique(signalIdSchema, s => s) }).strict();
export const comparisonSchema = z.object({ id: uuidSchema, profile_version: counter.nullable(), created_at: timestamp, ...versions, competencies: catalog(comparedCompetencySchema, c => c.competency_id, 7), focus_areas: z.array(focusAreaSchema), guide: unique(guideQuestionSchema, q => q.question_id).refine(q => q.length <= 8) }).strict();
const severity = z.enum(["none", "mild", "strong", "unknown"]);
const signal = <Id extends z.infer<typeof signalIdSchema>, T extends z.ZodTypeAny>(id: Id, counts: T) => z.object({ id: z.literal(id), severity, counts: counts.nullable() }).strict().refine(s => (s.severity === "unknown") === (s.counts === null));
export const qualitySchema = z.object({ tier: tierSchema, partial: z.boolean(), signals: catalog(z.union([
  signal("signal.attention", z.object({ misses: count.max(3), total: z.literal(3) }).strict()),
  signal("signal.long_string", z.object({ run: count.max(60) }).strict()),
  signal("signal.fast", z.object({ fast_count: count.max(60), total: z.literal(60) }).strict()),
  signal("signal.changes", z.object({ value_changes: count, clears: count, reanswers: count, total: count }).strict().refine(c => c.total === c.value_changes + c.clears + c.reanswers)),
]), s => s.id, 4) }).strict().refine(q => q.partial === q.signals.some(s => s.severity === "unknown"));
export const resultSchema = z.object({ invitation_id: uuidSchema, ...versions, finished_at: timestamp, facets: catalog(z.object({ facet_id: facetIdSchema, sum: z.number().int().min(4).max(20), band: bandSchema }).strict(), f => f.facet_id, 15), competencies: catalog(competencySchema, c => c.competency_id, 7), interpretations: catalog(z.object({ id: bankId("lib"), competency_id: competencyIdSchema, band: bandSchema, work_text: z.string(), strengths_text: z.string(), development_text: z.string() }).strict(), i => i.competency_id, 7), quality: qualitySchema, latest_comparison: comparisonSchema, comparisons: unique(z.object({ id: uuidSchema, profile_version: counter.nullable() }).strict(), c => c.id.toLowerCase()) }).strict();
export const consentBodySchema = z.object({ notice_version: z.literal("1"), text_sha256: z.string().regex(/^[a-f0-9]{64}$(?![\s\S])/) }).strict();
export const consentSchema = consentBodySchema.extend({ text: z.string() }).strict();
export const candidateBaseSchema = z.object({ company_name: z.string(), vacancy_title: z.string(), estimated_minutes: z.literal(10), status: invitationStatusSchema, answered_count: count.max(63), total_count: z.literal(63), expires_at: timestamp, consent: consentSchema.nullable() }).strict();
export const positionSchema = z.number().int().min(1).max(63);
const answerValue = z.number().int().min(1).max(5);
export const candidateItemsSchema = z.object({ scale: z.array(z.object({ value: answerValue, label: z.string() }).strict()).length(5).refine(s => s.every((v, i) => v.value === i + 1)), items: z.array(z.object({ position: positionSchema, text: z.string(), value: answerValue.nullable() }).strict()).length(63).refine(items => items.every((v, i) => v.position === i + 1)) }).strict();
export const answerBodySchema = z.object({ event_id: uuidSchema, value: answerValue, client_elapsed_ms: count.max(3600000).optional() }).strict();
export const clearAnswerBodySchema = z.object({ event_id: uuidSchema }).strict();
export const finishedSchema = z.object({ status: z.literal("finished") }).strict();
export const linkSchema = z.object({ token: z.string().min(1), expires_at: timestamp }).strict();
export const ERROR_CODES = ["assessment_unavailable", "consent_required", "notice_changed", "assessment_finished", "invitation_closed", "incomplete", "profile_disabled", "profile_unconfirmed", "already_finished", "participation_inactive", "process_finished", "rate_limited"] as const;
export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type ProfileBody = z.infer<typeof profileBodySchema>;
export type Invitation = z.infer<typeof invitationSchema>;
export type AssessmentResult = z.infer<typeof resultSchema>;
export type Comparison = z.infer<typeof comparisonSchema>;
export type Competency = z.infer<typeof competencySchema>;
export type ComparedCompetency = z.infer<typeof comparedCompetencySchema>;
export type FocusArea = z.infer<typeof focusAreaSchema>;
export type GuideQuestion = z.infer<typeof guideQuestionSchema>;
export type Quality = z.infer<typeof qualitySchema>;
export type CandidateBase = z.infer<typeof candidateBaseSchema>;
export type CandidateItems = z.infer<typeof candidateItemsSchema>;
export type Consent = z.infer<typeof consentSchema>;
export type FailureReason = ErrorCode | "unauthenticated" | "forbidden" | "not_found" | "version_conflict" | "precondition_required" | "validation_error" | "invalid_request" | "no_response" | "unrecognized_response" | "server_error";
export type Result<T> = { ok: true; data: T; etag?: string } | { ok: false; reason: FailureReason; fields?: ValidationField[]; missing_positions?: number[]; retryAfter?: string; reference: { status?: number; code?: string } };

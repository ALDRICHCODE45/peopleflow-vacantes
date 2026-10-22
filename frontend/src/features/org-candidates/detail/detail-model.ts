import { z } from "zod";
import { contactSchema, discardReasonSchema, profileSchema, uuidSchema } from "@/features/pipeline-movement/model";
import { lifecycleSchema } from "@/features/vacancy-lifecycle/model";

const text = z.string().refine(value => !!value.trim());
const timestamp = z.string().datetime({ offset: true });
export const orgCandidateIdentitySchema = z.object({ kind: z.enum(["manual", "organic"]), id: uuidSchema }).strict();
export type OrgCandidateIdentity = z.infer<typeof orgCandidateIdentitySchema>;
const named = z.object({ id: uuidSchema, name: text }).strict();
export const orgCandidateParticipationSchema = z.object({
  id: uuidSchema,
  vacancy: z.object({ id: uuidSchema, title: text, lifecycle: z.object({
    publication: lifecycleSchema.innerType().shape.publication,
    process: lifecycleSchema.innerType().shape.process,
  }).strict() }).strict(),
  stage: named, state: z.enum(["active", "discarded"]), substate: named.nullable(),
  discard: z.object({ reason: discardReasonSchema, comment: z.string().nullable(), discarded_at: timestamp }).strict().nullable(),
  source: z.enum(["manual", "organic"]), applied_at: timestamp, added_by: named.nullable(),
  cv: z.object({ file_name: text, uploaded_at: timestamp }).strict().nullable(),
}).strict().refine(item => (item.state === "discarded") === (item.discard !== null));
export const orgCandidateDetailSchema = orgCandidateIdentitySchema.extend({
  full_name: text, professional_title: z.string().nullable(), current_company: z.string().nullable(),
  contact: contactSchema, profile: profileSchema, participations: z.array(orgCandidateParticipationSchema),
  created_by: z.object({ id: uuidSchema, name: z.string().nullable() }).strict().nullable(), created_at: timestamp,
}).strict();
export type OrgCandidateDetail = z.infer<typeof orgCandidateDetailSchema>;
export type OrgCandidateParticipation = z.infer<typeof orgCandidateParticipationSchema>;
export type DetailFailure = { ok: false; reason: "not_found" | "unauthenticated" | "forbidden" | "server_error" | "no_response" | "unrecognized_response"; reference: { status?: number; code?: string } };
export type DetailResult = { ok: true; data: OrgCandidateDetail } | DetailFailure;
export function candidateCvHref(candidate: OrgCandidateIdentity, participationId: string) {
  return `/api/company/candidates/${encodeURIComponent(candidate.kind)}/${encodeURIComponent(candidate.id)}/participations/${encodeURIComponent(participationId)}/cv`;
}

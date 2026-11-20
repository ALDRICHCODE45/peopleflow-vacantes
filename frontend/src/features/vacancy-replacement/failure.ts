import { z } from "zod";
import { replacementConflictSchema, replacementInvalidSchema, validationErrorEnvelopeSchema } from "@/features/vacancy-lifecycle/replacement-errors";

/**
 * replacement-processes-v1 «Error codes» → Mexican Spanish (tú) copy for the start dialog. Pure (no `server-only`): the
 * backend `error` text never crosses this boundary, only the allowlisted classification, per-item copy and `missing[]`.
 */
export type StartFailureInput = { error: { kind: string; status?: number }; envelope?: unknown };
export type StartFailureReason =
  | "unauthenticated" | "forbidden" | "team_action_forbidden" | "not_found" | "invalid_request" | "validation_error" | "non_business_date"
  | "replacement_source_not_closed" | "replacement_source_not_latest" | "replacement_already_active" | "idempotency_conflict"
  | "version_conflict" | "precondition_required" | "replacement_credits_invalid" | "carried_candidate_invalid" | "carried_stage_invalid"
  | "not_company_member" | "publication_incomplete" | "server_error" | "no_response" | "unrecognized_response";
export type StartFieldErrors = Partial<Record<"target_quantity" | "commitment_date" | "responsible", string>>;
export type StartFailure = {
  ok: false;
  reason: StartFailureReason;
  message: string;
  reference: { status?: number; code?: string };
  fields?: StartFieldErrors;
  credits?: { credit_id: string; message: string }[];
  /** `index` is the position in the request's `carried_candidates`. */
  candidates?: { index: number; message: string }[];
  missing?: string[];
  /** The chain or the ETag moved: the caller reloads before asking to confirm again. */
  reload?: boolean;
  /** The request may have been applied; retrying with the SAME idempotency key never duplicates it. */
  uncertain?: boolean;
};

const messages = {
  unauthenticated: "Inicia sesión para continuar.",
  forbidden: "No tienes permiso para iniciar un reemplazo en esta vacante.",
  team_action_forbidden: "Solo el propietario de la empresa puede asignar a otra persona como responsable. Déjate a ti como responsable.",
  not_found: "No encontramos esta vacante o ya no tienes acceso.",
  invalid_request: "No pudimos enviar el reemplazo. Revisa los datos y vuelve a intentarlo.",
  validation_error: "Revisa los datos marcados.",
  non_business_date: "Ese día no es hábil. Elige otro día para la fecha compromiso.",
  replacement_source_not_closed: "Esta vacante aún no está cerrada. Revisa su estado actual.",
  replacement_source_not_latest: "Esta vacante ya tiene un proceso más reciente. Trabaja en ese proceso.",
  replacement_already_active: "Ya hay un reemplazo activo para esta vacante.",
  idempotency_conflict: "Esta solicitud ya se envió con datos distintos. Cierra el diálogo y vuelve a intentarlo.",
  version_conflict: "La vacante cambió. Actualizamos su estado; revisa los datos y vuelve a confirmar.",
  precondition_required: "La vacante cambió. Actualizamos su estado; revisa los datos y vuelve a confirmar.",
  replacement_credits_invalid: "Alguna baja ya no se puede reemplazar. Revisa la lista.",
  carried_candidate_invalid: "Algún candidato ya no se puede retomar. Revisa la lista.",
  carried_stage_invalid: "Alguna etapa inicial ya no es válida. Elige otra.",
  not_company_member: "Esa persona ya no forma parte de tu empresa. Elige otro responsable.",
  publication_incomplete: "No se puede publicar al iniciar: falta completar la vacante original.",
  server_error: "No pudimos confirmar si se inició el reemplazo. Vuelve a intentarlo: si ya se creó, no se duplicará.",
  no_response: "No pudimos confirmar si se inició el reemplazo. Vuelve a intentarlo: si ya se creó, no se duplicará.",
  unrecognized_response: "No pudimos interpretar la respuesta. Consulta tus vacantes para ver si el reemplazo se creó.",
} as const satisfies Record<StartFailureReason, string>;
const creditReasons = {
  not_in_chain: "Esta baja ya no pertenece a esta vacante.",
  not_did_not_hold: "Esta persona ya no figura como «No se sostuvo».",
  already_replaced: "Esta baja ya tiene un reemplazo.",
} as const;
const candidateReasons = {
  not_in_chain: "Esta persona ya no está en el proceso de esta vacante.",
  currently_placed: "Esta persona sigue en Placement; no se puede retomar.",
  duplicate: "Esta persona está repetida en la lista.",
} as const;
const stageReasons = {
  stage_not_found: "Esa etapa ya no existe en la vacante original. Elige otra.",
  stage_is_placement: "Nadie puede empezar en Placement. Elige otra etapa.",
  stage_is_exit: "Nadie puede empezar en Descartados. Elige otra etapa.",
} as const;
const fieldMessages = {
  below_credits_count: "El objetivo no puede ser menor que el número de bajas elegidas.",
  target_range: "El objetivo debe ser un número entre 1 y 999.",
  date_range: "La fecha compromiso debe estar entre hoy y dentro de un año.",
} as const;
const knownCodes = new Set<string>([
  ...Object.keys(messages), "idempotency_key_required", "invalid_idempotency_key", "team_access_ended", "internal_error",
]);
const publicationSchema = z.object({ code: z.literal("publication_incomplete"), missing: z.array(z.string().refine(value => value.trim().length > 0)) });

export function mapStartFailure({ error, envelope }: StartFailureInput): StartFailure {
  const status = error.status;
  const rawCode = z.object({ code: z.string() }).safeParse(envelope);
  const code = rawCode.success && knownCodes.has(rawCode.data.code) ? rawCode.data.code : undefined;
  const reference = { ...(status !== undefined ? { status } : {}), ...(code ? { code } : {}) };
  const done = (reason: StartFailureReason, extra: Partial<StartFailure> = {}): StartFailure =>
    ({ ok: false, reason, message: messages[reason], reference, ...extra });
  const uncertain = (reason: "server_error" | "no_response" | "unrecognized_response") => done(reason, { uncertain: true });
  const conflict = replacementConflictSchema.safeParse(envelope);
  const invalid = replacementInvalidSchema.safeParse(envelope);

  if (error.kind === "missing_token" || status === 401) return done("unauthenticated");
  if (error.kind === "invalid_request") return done("invalid_request");
  if (error.kind === "network" || error.kind === "timeout") return uncertain("no_response");
  if (error.kind === "invalid_response") return uncertain("unrecognized_response");
  if (status === 400) {
    if (code === "non_business_date") return done("non_business_date", { fields: { commitment_date: messages.non_business_date } });
    const validation = validationErrorEnvelopeSchema.safeParse(envelope);
    if (code === "validation_error" && validation.success) {
      const fields: StartFieldErrors = {};
      for (const { field, code: fieldCode } of validation.data.fields ?? []) {
        if (field === "target_quantity") fields.target_quantity = fieldCode === "below_credits_count" ? fieldMessages.below_credits_count : fieldMessages.target_range;
        else if (field === "commitment_date") fields.commitment_date = fieldMessages.date_range;
      }
      if (Object.keys(fields).length > 0) return done("validation_error", { fields });
    }
    return done("invalid_request");
  }
  if (status === 403) return code === "team_action_forbidden" ? done("team_action_forbidden", { fields: { responsible: messages.team_action_forbidden } }) : done("forbidden");
  if (status === 404) return done("not_found");
  if (status === 412) return done("version_conflict", { reload: true });
  if (status === 428) return done("precondition_required", { reload: true });
  if (status === 409) {
    if (conflict.success && conflict.data.code !== "reopen_requires_replacement" && conflict.data.code !== "reopen_superseded") return done(conflict.data.code, { reload: true });
    if (code === "idempotency_conflict") return done("idempotency_conflict");
  }
  if (status === 422) {
    if (invalid.success) {
      const data = invalid.data;
      if (data.code === "replacement_credits_invalid") return done(data.code, { reload: true, credits: data.data.credits.map(item => ({ credit_id: item.credit_id, message: creditReasons[item.reason] })) });
      if (data.code === "carried_candidate_invalid") return done(data.code, { reload: true, candidates: data.data.candidates.map(item => ({ index: item.index, message: candidateReasons[item.reason] })) });
      return done(data.code, { candidates: data.data.candidates.map(item => ({ index: item.index, message: stageReasons[item.reason] })) });
    }
    if (code === "not_company_member") return done("not_company_member", { fields: { responsible: messages.not_company_member } });
    const incomplete = publicationSchema.safeParse(envelope);
    if (incomplete.success) return done("publication_incomplete", { missing: incomplete.data.missing });
  }
  if (status !== undefined && status >= 500 && status < 600) return uncertain("server_error");
  return uncertain("unrecognized_response");
}

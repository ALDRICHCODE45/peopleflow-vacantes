import "server-only";
import type { ClientFailure } from "./client";
import { processFinishedSchema, type Failure, type FailureReason } from "./model";
const codes: Record<string, { status: number; reason: FailureReason }> = {
  board_too_large: { status: 422, reason: "board_too_large" }, vacancy_not_published: { status: 409, reason: "vacancy_not_published" },
  stage_skip_not_allowed: { status: 409, reason: "stage_skip_not_allowed" }, placement_exit_confirmation_required: { status: 409, reason: "placement_exit_confirmation_required" },
  already_discarded: { status: 409, reason: "already_discarded" }, not_discarded: { status: 409, reason: "not_discarded" },
  placement_reentry_confirmation_required: { status: 409, reason: "placement_reentry_confirmation_required" },
  recovery_stage_required: { status: 409, reason: "recovery_stage_required" },
  substate_requires_in_process: { status: 409, reason: "substate_requires_in_process" },
  validation_error: { status: 400, reason: "validation_error" }, invalid_request: { status: 400, reason: "invalid_request" },
  cv_storage_unavailable: { status: 503, reason: "cv_storage_unavailable" }, company_inactive: { status: 403, reason: "company_inactive" },
  company_not_active: { status: 409, reason: "company_not_active" }, unauthenticated: { status: 401, reason: "unauthenticated" },
  forbidden: { status: 403, reason: "forbidden" }, not_found: { status: 404, reason: "not_found" },
  version_conflict: { status: 412, reason: "version_conflict" }, precondition_required: { status: 428, reason: "precondition_required" },
};
export function movementFailure({ error, envelope }: ClientFailure, write = false): Failure {
  const status = error.status, code = envelope?.code;
  const finished = processFinishedSchema.safeParse(envelope);
  if (write && status === 409 && finished.success) return { ok: false, reason: "process_finished", lifecycle: finished.data.data.lifecycle, reference: { status, code: "process_finished" } };
  const known = code && Object.hasOwn(codes, code) ? codes[code] : undefined;
  let reason: FailureReason = "unrecognized_response";
  if (error.kind === "missing_token" || status === 401) reason = "unauthenticated";
  else if (error.kind === "invalid_request") reason = "invalid_request";
  else if (error.kind === "network" || error.kind === "timeout") reason = write ? "uncertain" : "no_response";
  else if (known && known.status === status) reason = known.reason;
  else if (status === 403) reason = "forbidden";
  else if (status === 404) reason = "not_found";
  else if (status === 412) reason = "version_conflict";
  else if (status === 428) reason = "precondition_required";
  else if (status !== undefined && status >= 500 && status < 600) reason = write ? "uncertain" : "server_error";
  return { ok: false, reason, reference: { ...(status !== undefined ? { status } : {}), ...(known || code === "internal_error" ? { code } : {}) } };
}

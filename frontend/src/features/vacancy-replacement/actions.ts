"use server";

import { getActionAccessToken } from "@/lib/auth/action-session";
import { getLifecycle } from "@/features/vacancy-lifecycle/client";
import { getCalendar, getCompanyMembers } from "@/features/vacancy-team/api-client";
import { getReplacements, startReplacement, type StartInput } from "./client";
import { mapStartFailure, type StartFailure } from "./failure";
import type { StartContext, Started } from "./model";

export type StartContextFailure = { ok: false; reason: "unauthenticated" | "forbidden" | "not_found" | "unavailable"; message: string };
export type StartContextResult = { ok: true; data: StartContext } | StartContextFailure;
export type StartActionInput = Omit<StartInput, "token">;
export type StartActionResult = { ok: true; data: Started; etag: string; idempotencyReplayed: "true" | "false" } | StartFailure;

const contextMessages = {
  unauthenticated: "Inicia sesión para continuar.",
  forbidden: "No tienes permiso para iniciar un reemplazo en esta vacante.",
  not_found: "No encontramos esta vacante o ya no tienes acceso.",
  unavailable: "No pudimos cargar las bajas. Vuelve a intentarlo.",
} as const;
const contextFailure = (reason: StartContextFailure["reason"]): StartContextFailure => ({ ok: false, reason, message: contextMessages[reason] });
const byStatus = (status: number | undefined, kind?: string): StartContextFailure["reason"] =>
  kind === "missing_token" || status === 401 ? "unauthenticated" : status === 403 ? "forbidden" : status === 404 ? "not_found" : "unavailable";

/**
 * Everything the start dialog needs from one session: the chain (`GET V/replacements`), the SOURCE's lifecycle ETag for
 * `If-Match`, the company members for the responsible and the business calendar for the commitment date.
 */
export async function loadStartContextAction(draftId: string): Promise<StartContextResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return contextFailure("unauthenticated");
    const [replacements, lifecycle, members, calendar] = await Promise.all([
      getReplacements({ token, draftId }), getLifecycle({ token, draftId }),
      getCompanyMembers({ token, vacancyId: draftId }), getCalendar({ token, vacancyId: draftId }),
    ]);
    if (!replacements.ok) return contextFailure(byStatus(replacements.error.status, replacements.error.kind));
    if (!lifecycle.ok) return contextFailure(byStatus(lifecycle.error.status, lifecycle.error.kind));
    if (!members.ok) return contextFailure(byStatus(members.status));
    if (!calendar.ok) return contextFailure(byStatus(calendar.status));
    return { ok: true, data: { replacements: replacements.data, etag: lifecycle.etag, members: members.data.members, calendar: calendar.data.calendar } };
  } catch {
    return contextFailure("unavailable");
  }
}

/** One confirmed intent. The caller keeps its Idempotency-Key and replays it unchanged after an unconfirmed result. */
export async function startReplacementAction(input: StartActionInput): Promise<StartActionResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return mapStartFailure({ error: { kind: "missing_token" } });
    const result = await startReplacement({ ...input, token });
    return result.ok ? result : mapStartFailure(result);
  } catch {
    return mapStartFailure({ error: { kind: "network" } });
  }
}

"use server";

import { getActionAccessToken } from "@/lib/auth/action-session";
import { getAuditActors, getAuditTypes, getAuditVacancies, listAuditEvents } from "./client";
import { toAuditFailure } from "./failure";
import type { AuditFailure, AuditListResult, AuditOptionsResult } from "./model";
import type { AuditQuery } from "./url-state";

const unauthenticated: AuditFailure = { ok: false, reason: "unauthenticated", reference: {} };
const noResponse: AuditFailure = { ok: false, reason: "no_response", reference: {} };
/** When several catalogs fail, the reason that tells the owner the most wins. */
const SEVERITY: AuditFailure["reason"][] = ["unauthenticated", "forbidden", "server_error", "no_response", "unrecognized_response"];

/** Owner-only list (D5): the API answers 403 to anyone else and nothing here widens that. */
export async function listAuditEventsAction(input: AuditQuery = {}): Promise<AuditListResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return unauthenticated;
    const result = await listAuditEvents({ ...input, token });
    return result.ok ? result : toAuditFailure(result);
  } catch { return noResponse; }
}

/** Types, actors (including former members) and vacancies that feed the filters. */
export async function loadAuditOptionsAction(): Promise<AuditOptionsResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return unauthenticated;
    const [types, actors, vacancies] = await Promise.all([getAuditTypes(token), getAuditActors(token), getAuditVacancies(token)]);
    if (types.ok && actors.ok && vacancies.ok) return { ok: true, types: types.data.items, actors: actors.data.items, vacancies: vacancies.data.items };
    const failures = [types, actors, vacancies].flatMap(result => result.ok ? [] : [toAuditFailure(result)]);
    return failures.sort((a, b) => SEVERITY.indexOf(a.reason) - SEVERITY.indexOf(b.reason))[0];
  } catch { return noResponse; }
}

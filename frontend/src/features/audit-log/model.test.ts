import { describe, expect, it } from "vitest";
import {
  actorsSchema, auditEventPageSchema, auditTypesSchema, auditVacanciesSchema, describeActor, describeBrowser, errorEnvelopeSchema, vacancyTitleLabel,
  eventLabel, exportErrorMessage, parseExportBody, exportRangeError, formatOccurredAt, KNOWN_EVENT_TYPES, listFailureMessage, UNKNOWN_EVENT_LABEL,
} from "./model";
import { auditActors, auditEvent, auditPage, auditTypes, auditVacancies } from "./test-fixtures";

describe("response decoding (contract §8)", () => {
  it("accepts the contract example, a system actor and every nullable", () => {
    expect(auditEventPageSchema.parse(auditPage([auditEvent()]))).toEqual(auditPage([auditEvent()]));
    const system = auditEvent({ actor: { type: "system" }, vacancy: null, ip: null, ip_source: null, user_agent: null, entity: { type: "company", id: "c", label: null } });
    expect(auditEventPageSchema.parse(auditPage([system], { next_cursor: "abc" })).items[0]).toEqual(system);
    const deleted = auditEvent({ actor: { type: "user", user_id: auditActors[0].user_id, name: null, email: null, is_current_member: false }, vacancy: { id: auditVacancies[0].vacancy_id, title: null } });
    expect(auditEventPageSchema.parse(auditPage([deleted])).items[0]).toEqual(deleted);
  });

  it.each([
    ["an extra top-level key", { ...auditPage(), extra: true }],
    ["a missing total", { items: [], next_cursor: null }],
    ["a negative total", { ...auditPage(), total: -1 }],
    ["a missing next_cursor", { items: [], total: 0 }],
    ["an item with an unknown key", auditPage([{ ...auditEvent(), password: "x" } as never])],
    ["a non-ISO occurred_at", auditPage([auditEvent({ occurred_at: "ayer" })])],
    ["an unknown ip_source", auditPage([auditEvent({ ip_source: "proxy" as never })])],
    ["an actor of an unknown type", auditPage([auditEvent({ actor: { type: "bot" } as never })])],
    ["a user actor without is_current_member", auditPage([auditEvent({ actor: { type: "user", user_id: "10000000-0000-4000-8000-000000000002", name: "A", email: null } as never })])],
    ["a non-uuid vacancy id", auditPage([auditEvent({ vacancy: { id: "no", title: "x" } })])],
    ["an entity without id", auditPage([auditEvent({ entity: { type: "company", label: null } as never })])],
  ])("rejects %s", (_name, value) => {
    expect(auditEventPageSchema.safeParse(value).success).toBe(false);
  });

  it("accepts an event type the frontend has never seen", () => {
    const future = auditEvent({ event_type: "SomethingNew", category: "brand_new" });
    expect(auditEventPageSchema.parse(auditPage([future])).items[0].event_type).toBe("SomethingNew");
  });

  it("decodes the three catalogs and rejects drift", () => {
    expect(auditTypesSchema.parse({ items: auditTypes }).items).toHaveLength(4);
    expect(actorsSchema.parse({ items: auditActors }).items[1].is_current_member).toBe(false);
    expect(auditVacanciesSchema.parse({ items: auditVacancies }).items[1].title).toBeNull();
    expect(auditTypesSchema.safeParse({ items: [{ event_type: "X" }] }).success).toBe(false);
    expect(actorsSchema.safeParse({ items: [{ user_id: "nope", name: null, email: null, is_current_member: true }] }).success).toBe(false);
    expect(auditVacanciesSchema.safeParse({ items: [], extra: 1 }).success).toBe(false);
  });

  it("decodes the error envelope with fields and the too-large counters", () => {
    expect(errorEnvelopeSchema.parse({ error: "x", code: "invalid_filter", fields: [{ field: "from", code: "range" }] }).fields).toEqual([{ field: "from", code: "range" }]);
    expect(errorEnvelopeSchema.parse({ error: "x", code: "audit_export_too_large", row_count: 60000, limit: 50000 })).toMatchObject({ row_count: 60000, limit: 50000 });
    expect(errorEnvelopeSchema.safeParse({ code: "x" }).success).toBe(false);
  });
});

describe("labels (contract Annex)", () => {
  it("labels every Annex type in es-MX", () => {
    expect(eventLabel("SessionStarted")).toBe("Inició sesión");
    expect(eventLabel("SessionEnded")).toBe("Cerró sesión");
    expect(eventLabel("CompanyCandidateCVDownloaded")).toBe("Inició la descarga de un CV");
    expect(eventLabel("AuditLogExported")).toBe("Exportó la auditoría");
    expect(eventLabel("TalentBaseVisibilityChanged")).toBe("Cambió quién ve la Base de talento");
    // The Annex lists the whole 2a catalog (63 types at backend 00ddbe97), not only the new events.
    expect(eventLabel("JobDraftCreated")).toBe("Creó una vacante");
    expect(eventLabel("CompanyCandidateEdited")).toBe("Editó los datos de un candidato");
    expect(eventLabel("VacancyTeamCreated")).toBe("Creó el equipo de una vacante");
    expect(KNOWN_EVENT_TYPES).toHaveLength(63);
    expect(new Set(KNOWN_EVENT_TYPES.map(type => type.event_type)).size).toBe(63);
    expect(KNOWN_EVENT_TYPES.filter(type => eventLabel(type.event_type) === UNKNOWN_EVENT_LABEL)).toEqual([]);
  });

  it("gives an unknown type a generic label instead of crashing, including prototype keys", () => {
    expect(eventLabel("SomethingNew")).toBe(UNKNOWN_EVENT_LABEL);
    expect(eventLabel("constructor")).toBe(UNKNOWN_EVENT_LABEL);
    expect(eventLabel("")).toBe(UNKNOWN_EVENT_LABEL);
  });
});

describe("presentation helpers", () => {
  it("labels a vacancy by title, an untitled draft and a deleted vacancy distinctly (contract §8.4)", () => {
    expect(vacancyTitleLabel("Ejecutivo de ventas")).toEqual({ label: "Ejecutivo de ventas", missing: false });
    expect(vacancyTitleLabel("")).toEqual({ label: "Vacante sin título", missing: true });
    expect(vacancyTitleLabel("   ")).toEqual({ label: "Vacante sin título", missing: true });
    expect(vacancyTitleLabel(null)).toEqual({ label: "Vacante eliminada", missing: true });
  });

  it("formats the moment in America/Mexico_City", () => {
    expect(formatOccurredAt("2026-11-04T17:03:12.441Z")).toMatch(/11:03:12/);
    expect(formatOccurredAt("2026-11-04T02:30:00Z")).toMatch(/3 nov/i);
    expect(formatOccurredAt("garbage")).toBe("—");
  });

  it("names the actor: «Sistema», «Usuario eliminado», former members", () => {
    expect(describeActor({ type: "system" })).toEqual({ name: "Sistema", email: null, former: false, system: true });
    expect(describeActor({ type: "user", user_id: "u", name: null, email: null, is_current_member: false })).toEqual({ name: "Usuario eliminado", email: null, former: true, system: false });
    expect(describeActor(auditEvent().actor)).toEqual({ name: "Ana López", email: "ana@empresa.mx", former: false, system: false });
    expect(describeActor({ type: "user", user_id: "u", name: "Luis", email: null, is_current_member: false }).former).toBe(true);
  });

  it("summarises the browser and keeps null honest", () => {
    expect(describeBrowser(auditEvent().user_agent)).toBe("Safari · macOS");
    expect(describeBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0")).toBe("Edge · Windows");
    expect(describeBrowser("Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0")).toBe("Firefox · Linux");
    expect(describeBrowser("curl/8.0")).toBe("curl/8.0");
    expect(describeBrowser(null)).toBe("—");
  });
});

describe("export range (D7: required, ≤ 366 days)", () => {
  it.each([
    [undefined, "2026-11-04", "required"],
    ["2026-11-01", undefined, "required"],
    ["2026-13-01", "2026-11-04", "invalid"],
    ["2026-02-30", "2026-03-04", "invalid"],
    ["2026-11-05", "2026-11-04", "order"],
    ["2025-11-03", "2026-11-04", "too_long"],
  ] as const)("rejects %s → %s as %s", (from, to, code) => {
    expect(exportRangeError(from, to)).toBe(code);
  });
  it("accepts a single day and exactly 366 days inclusive (a leap year)", () => {
    expect(exportRangeError("2026-11-04", "2026-11-04")).toBeUndefined();
    expect(exportRangeError("2024-01-01", "2024-12-31")).toBeUndefined();
    expect(exportRangeError("2024-01-01", "2025-01-01")).toBe("too_long");
  });
});

describe("failure messages (es-MX)", () => {
  it("explains each list failure without backend text", () => {
    expect(listFailureMessage({ ok: false, reason: "forbidden", reference: {} })).toMatch(/Solo el owner/);
    expect(listFailureMessage({ ok: false, reason: "unauthenticated", reference: {} })).toMatch(/sesión expiró/);
    expect(listFailureMessage({ ok: false, reason: "invalid_filter", reference: {} })).toMatch(/filtros/);
    expect(listFailureMessage({ ok: false, reason: "invalid_filter", fields: [{ field: "from", code: "range" }], reference: {} })).toMatch(/«Desde»/);
    expect(listFailureMessage({ ok: false, reason: "server_error", reference: {} })).toMatch(/volver a intentarlo/);
  });

  it("explains the export errors, including row_count and limit of a too-large export", () => {
    expect(exportErrorMessage({ status: 422, code: "audit_export_too_large", row_count: 60123, limit: 50000 })).toBe(
      "La exportación tiene 60,123 registros y el límite es 50,000. Acorta el rango de fechas o agrega filtros; no se descargó ningún archivo.");
    expect(exportErrorMessage({ status: 422, code: "audit_export_too_large" })).toMatch(/supera el límite/);
    expect(exportErrorMessage({ status: 403, code: "forbidden" })).toMatch(/Solo el owner/);
    expect(exportErrorMessage({ status: 422, code: "invalid_filter" })).toMatch(/366 días/);
    expect(exportErrorMessage({ status: 401, code: "unauthenticated" })).toMatch(/sesión expiró/);
    expect(exportErrorMessage({ status: 503 })).toMatch(/No se descargó ningún archivo/);
  });
});

describe("export body validation (shared by the route handler and the client)", () => {
  const valid = { from: "2026-11-01", to: "2026-11-04" };
  it("accepts the contract body and returns only the known keys", () => {
    expect(parseExportBody({ ...valid, actor_id: auditActors[0].user_id, event_types: ["SessionEnded"], category: "session" })).toEqual({
      ok: true, data: { ...valid, actor_id: auditActors[0].user_id, event_types: ["SessionEnded"], category: "session" } });
    expect(parseExportBody(valid)).toEqual({ ok: true, data: valid });
  });
  it.each([
    ["no body", null, [{ field: "body", code: "invalid" }]],
    ["a missing from", { to: "2026-11-04" }, [{ field: "from", code: "required" }]],
    ["both ends missing", {}, [{ field: "from", code: "required" }, { field: "to", code: "required" }]],
    ["an unknown key", { ...valid, password: "x" }, [{ field: "password", code: "unknown" }]],
    ["a malformed day", { from: "2026-02-30", to: "2026-03-04" }, [{ field: "from", code: "invalid" }]],
    ["an inverted range", { from: "2026-11-05", to: "2026-11-04" }, [{ field: "from", code: "range" }]],
    ["more than 366 days", { from: "2025-01-01", to: "2026-11-04" }, [{ field: "from", code: "range" }]],
    ["a non-uuid actor", { ...valid, actor_id: "x" }, [{ field: "actor_id", code: "invalid" }]],
    ["a bad event type", { ...valid, event_types: ["<b>"] }, [{ field: "event_types", code: "invalid" }]],
  ])("rejects %s with contract field codes", (_name, body, fields) => {
    expect(parseExportBody(body)).toEqual({ ok: false, fields });
  });
});

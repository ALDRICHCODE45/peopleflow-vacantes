import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadReplacementSummaryAction, loadStartContextAction, startReplacementAction } from "./actions";
import { calendar, etag, ids, lifecycleWire, members, neverPublishedWire, replacementItemWire, replacementsWire, startedWire, uuid } from "./test-fixtures";

vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "https://api.example.test", apiTimeoutMs: 1000 } }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn(async () => "token") }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/vacancy-team/api-client", () => ({
  getCompanyMembers: vi.fn(async () => ({ ok: true, data: { members } })),
  getCalendar: vi.fn(async () => ({ ok: true, data: { calendar, commitmentDate: null } })),
}));

const fetchMock = vi.fn();
const base = `https://api.example.test/v2/me/company/job-drafts/${ids.draft}`;
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });

const body = {
  placement_credit_ids: [ids.creditRicardo, ids.creditLuis], target_quantity: 2, commitment_date: "2026-12-15", publish: false,
  carried_candidates: [{ candidate: { kind: "manual" as const, id: ids.mauricio }, stage_id: ids.stageInterview }],
};
const input = { draftId: ids.draft, ifMatch: etag, idempotencyKey: ids.key, body };
const created = () => json(startedWire(), 201, { etag: `"vl-${ids.newDraft}-v1"`, "idempotency-replayed": "false", location: `/v2/me/company/job-drafts/${ids.newDraft}` });

describe("loadStartContextAction", () => {
  function route(overrides: { replacements?: () => Response; lifecycle?: () => Response } = {}) {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === `${base}/replacements`) return (overrides.replacements ?? (() => json(replacementsWire())))();
      if (url === `${base}/lifecycle`) return (overrides.lifecycle ?? (() => json({ ...lifecycleWire(ids.draft, "7"), publication: "closed", process: "finished", kind: "original" }, 200, { etag })))();
      throw new Error(`unexpected ${url}`);
    });
  }
  it("reads the chain, the SOURCE lifecycle ETag, the company members and the business calendar", async () => {
    route();
    const result = await loadStartContextAction(ids.draft);
    expect(result).toMatchObject({ ok: true, data: { etag, members, calendar } });
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.replacements.start_replacement.startable_credits.map(item => item.candidate.full_name)).toEqual(["Ricardo Morales García", "Luis Pérez"]);
    expect(result.data.replacements.carry_candidates).toHaveLength(3);
    const [, init] = fetchMock.mock.calls.find(([url]) => url === `${base}/replacements`)!;
    expect(init.method).toBe("GET");
    expect(Object.fromEntries(new Headers(init.headers))).toMatchObject({ authorization: "Bearer token" });
  });
  it("tolerates new keys and the empty shape of a source that cannot start", async () => {
    route({ replacements: () => json({ ...replacementsWire({ allowed: false, blocker: "not_latest", startable_credits: [], publish_ready: null, missing: [] }, { carry_candidates: [], future: { x: 1 } }) }) });
    const result = await loadStartContextAction(ids.draft);
    expect(result).toMatchObject({ ok: true, data: { replacements: { start_replacement: { allowed: false, blocker: "not_latest", publish_ready: null } } } });
  });
  it.each([
    [401, "unauthenticated"], [403, "forbidden"], [404, "not_found"], [500, "unavailable"],
  ] as const)("maps a %s read to %s without forwarding the server text", async (status, reason) => {
    route({ replacements: () => json({ error: "private detail", code: "x" }, status) });
    const result = await loadStartContextAction(ids.draft);
    expect(result).toMatchObject({ ok: false, reason });
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("fails closed on a malformed chain view", async () => {
    route({ replacements: () => json({ root_process_id: "nope" }) });
    expect(await loadStartContextAction(ids.draft)).toMatchObject({ ok: false, reason: "unavailable" });
  });
});

describe("loadReplacementSummaryAction (the board's single read)", () => {
  it("is one GET V/replacements without ETag or If-Match, and keeps only the chain names and the credits", async () => {
    const wire = replacementsWire();
    fetchMock.mockImplementation(async () => json({ ...wire, items: [...wire.items, replacementItemWire(ids.newDraft)] }));
    const result = await loadReplacementSummaryAction(ids.draft);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${base}/replacements`);
    expect(init.method).toBe("GET");
    expect(Object.fromEntries(new Headers(init.headers))).not.toHaveProperty("if-match");
    expect(result).toMatchObject({ ok: true, data: { items: [{ id: ids.draft, sequence: 0 }, { id: ids.newDraft, sequence: 1 }], credits: [{ id: ids.creditRicardo }, { id: ids.creditLuis }] } });
    expect(JSON.stringify(result)).not.toContain("Mauricio");
  });
  it("answers an empty summary for a draft that never published", async () => {
    fetchMock.mockImplementation(async () => json(neverPublishedWire()));
    expect(await loadReplacementSummaryAction(ids.draft)).toEqual({ ok: true, data: { items: [], credits: [] } });
  });
  it.each([
    ["a 401", () => json({ error: "x", code: "unauthorized" }, 401)],
    ["a 404", () => json({ error: "x", code: "not_found" }, 404)],
    ["a 500", () => json({ error: "private detail", code: "x" }, 500)],
    ["a malformed body", () => json({ root_process_id: "nope" })],
    ["a chain item with a null sequence", () => json({ ...replacementsWire(), items: [{ ...replacementsWire().items[0], sequence: null }] })],
  ])("fails closed on %s", async (_name, response) => {
    fetchMock.mockImplementation(async () => response());
    expect(await loadReplacementSummaryAction(ids.draft)).toEqual({ ok: false });
  });
  it("fails closed when the session is gone", async () => {
    const { getActionAccessToken } = await import("@/lib/auth/action-session");
    vi.mocked(getActionAccessToken).mockResolvedValueOnce(null as never);
    expect(await loadReplacementSummaryAction(ids.draft)).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("startReplacementAction", () => {
  it("POSTs the exact contract body with the lifecycle ETag and an Idempotency-Key", async () => {
    fetchMock.mockImplementation(async () => created());
    await startReplacementAction(input);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${base}/replacements`);
    expect(init.method).toBe("POST");
    expect(Object.fromEntries(new Headers(init.headers))).toMatchObject({ authorization: "Bearer token", "if-match": etag, "idempotency-key": ids.key, "content-type": "application/json" });
    expect(JSON.parse(init.body)).toEqual(body);
  });
  it("sends responsible only when another person is named", async () => {
    fetchMock.mockImplementation(async () => created());
    await startReplacementAction({ ...input, body: { ...body, responsible: { user_id: ids.ana }, publish: true } });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ ...body, responsible: { user_id: ids.ana }, publish: true });
  });
  it("decodes the 201 non-strictly as {id, kind, lifecycle} plus the headers", async () => {
    fetchMock.mockImplementation(async () => created());
    const result = await startReplacementAction(input);
    expect(result).toEqual({ ok: true, data: { id: ids.newDraft, kind: "replacement", lifecycle: lifecycleWire(ids.newDraft) }, etag: `"vl-${ids.newDraft}-v1"`, idempotencyReplayed: "false" });
  });
  it("reports a frozen replay", async () => {
    fetchMock.mockImplementation(async () => json(startedWire(), 201, { etag: `"vl-${ids.newDraft}-v1"`, "idempotency-replayed": "true" }));
    expect(await startReplacementAction(input)).toMatchObject({ ok: true, idempotencyReplayed: "true" });
  });
  it.each([
    ["a 201 whose kind is not replacement", () => json(startedWire({ kind: "original" }), 201, { etag: `"vl-${ids.newDraft}-v1"`, "idempotency-replayed": "false" })],
    ["a 201 without id", () => json({ ...startedWire(), id: undefined }, 201, { etag: `"vl-${ids.newDraft}-v1"`, "idempotency-replayed": "false" })],
    ["a 201 with an ETag of another draft", () => json(startedWire(), 201, { etag: etag, "idempotency-replayed": "false" })],
    ["a 201 without Idempotency-Replayed", () => json(startedWire(), 201, { etag: `"vl-${ids.newDraft}-v1"` })],
    ["a 200 instead of 201", () => json(startedWire(), 200, { etag: `"vl-${ids.newDraft}-v1"`, "idempotency-replayed": "false" })],
  ])("treats %s as an unconfirmed result", async (_name, response) => {
    fetchMock.mockImplementation(async () => response());
    expect(await startReplacementAction(input)).toMatchObject({ ok: false, reason: "unrecognized_response", uncertain: true });
  });
  it.each([
    ["no credits", { ...body, placement_credit_ids: [] }],
    ["repeated credits", { ...body, placement_credit_ids: [ids.creditLuis, ids.creditLuis] }],
    ["an objetivo below the bajas", { ...body, target_quantity: 1 }],
    ["an objetivo above 999", { ...body, target_quantity: 1000 }],
    ["a malformed date", { ...body, commitment_date: "15/12/2026" }],
    ["more than 200 carried candidates", { ...body, carried_candidates: Array.from({ length: 201 }, (_, i) => ({ candidate: { kind: "manual" as const, id: uuid(500 + i) }, stage_id: ids.stageNew })) }],
    ["an unknown key", { ...body, extra: true } as never],
  ])("rejects %s before any request", async (_name, bad) => {
    expect(await startReplacementAction({ ...input, body: bad })).toMatchObject({ ok: false, reason: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects a bad key or an ETag of another draft before any request", async () => {
    expect(await startReplacementAction({ ...input, idempotencyKey: "nope" })).toMatchObject({ ok: false, reason: "invalid_request" });
    expect(await startReplacementAction({ ...input, ifMatch: `"vl-${ids.newDraft}-v1"` })).toMatchObject({ ok: false, reason: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("startReplacementAction error codes → Mexican Spanish copy", () => {
  const lifecycle = { ...lifecycleWire(ids.draft, "7"), publication: "closed", process: "finished" };
  const fail = (status: number, payload: Record<string, unknown>) => fetchMock.mockImplementation(async () => json({ error: "private backend text", ...payload }, status));
  const run = () => startReplacementAction(input);
  it.each([
    [409, "replacement_source_not_closed", { lifecycle }, "Esta vacante aún no está cerrada. Revisa su estado actual."],
    [409, "replacement_source_not_latest", { latest_process_id: ids.newDraft, root_process_id: ids.root, lifecycle }, "Esta vacante ya tiene un proceso más reciente. Trabaja en ese proceso."],
    [409, "replacement_already_active", { process_id: ids.newDraft, root_process_id: ids.root, lifecycle }, "Ya hay un reemplazo activo para esta vacante."],
  ] as const)("maps %s %s and reloads", async (status, code, data, message) => {
    fail(status, { code, data });
    expect(await run()).toMatchObject({ ok: false, reason: code, message, reload: true, reference: { status, code } });
  });
  it("maps credits rejected per credit", async () => {
    fail(422, { code: "replacement_credits_invalid", data: { credits: [{ credit_id: ids.creditRicardo, reason: "already_replaced" }, { credit_id: ids.creditLuis, reason: "not_did_not_hold" }] } });
    expect(await run()).toMatchObject({
      ok: false, reason: "replacement_credits_invalid", reload: true, message: "Alguna baja ya no se puede reemplazar. Revisa la lista.",
      credits: [{ credit_id: ids.creditRicardo, message: "Esta baja ya tiene un reemplazo." }, { credit_id: ids.creditLuis, message: "Esta persona ya no figura como «No se sostuvo»." }],
    });
    fail(422, { code: "replacement_credits_invalid", data: { credits: [{ credit_id: ids.creditRicardo, reason: "not_in_chain" }] } });
    expect(await run()).toMatchObject({ credits: [{ credit_id: ids.creditRicardo, message: "Esta baja ya no pertenece a esta vacante." }] });
  });
  it.each([
    ["not_in_chain", "Esta persona ya no está en el proceso de esta vacante."],
    ["currently_placed", "Esta persona sigue en Placement; no se puede retomar."],
    ["duplicate", "Esta persona está repetida en la lista."],
    ["departed_hire", "Esta persona no se sostuvo en el puesto que se reemplaza; no se puede retomar. Si vuelve, agrégala como candidato nuevo."],
  ] as const)("maps carried_candidate_invalid %s", async (reason, message) => {
    fail(422, { code: "carried_candidate_invalid", data: { candidates: [{ index: 0, reason }] } });
    expect(await run()).toMatchObject({ ok: false, reason: "carried_candidate_invalid", reload: true, candidates: [{ index: 0, message }] });
  });
  it.each([
    ["stage_not_found", "Esa etapa ya no existe en la vacante original. Elige otra."],
    ["stage_is_placement", "Nadie puede empezar en Placement. Elige otra etapa."],
    ["stage_is_exit", "Nadie puede empezar en Descartados. Elige otra etapa."],
  ] as const)("maps carried_stage_invalid %s", async (reason, message) => {
    fail(422, { code: "carried_stage_invalid", data: { candidates: [{ index: 0, reason }] } });
    expect(await run()).toMatchObject({ ok: false, reason: "carried_stage_invalid", candidates: [{ index: 0, message }] });
  });
  it.each([
    [[{ field: "target_quantity", code: "below_credits_count" }], { target_quantity: "El objetivo no puede ser menor que el número de bajas elegidas." }],
    [[{ field: "target_quantity", code: "out_of_range" }], { target_quantity: "El objetivo debe ser un número entre 1 y 999." }],
    [[{ field: "commitment_date", code: "out_of_range" }], { commitment_date: "La fecha compromiso debe estar entre hoy y dentro de un año." }],
  ])("maps validation_error fields %j inline", async (fields, expected) => {
    fail(400, { code: "validation_error", fields });
    expect(await run()).toMatchObject({ ok: false, reason: "validation_error", fields: expected });
  });
  it("maps a validation_error without known fields to the generic request copy", async () => {
    fail(400, { code: "validation_error" });
    expect(await run()).toMatchObject({ ok: false, reason: "invalid_request", message: "No pudimos enviar el reemplazo. Revisa los datos y vuelve a intentarlo." });
  });
  it("maps non_business_date inline on the commitment date", async () => {
    fail(400, { code: "non_business_date" });
    expect(await run()).toMatchObject({ ok: false, reason: "non_business_date", fields: { commitment_date: "Ese día no es hábil. Elige otro día para la fecha compromiso." } });
  });
  it.each([["invalid_request"], ["idempotency_key_required"], ["invalid_idempotency_key"]])("maps 400 %s", async code => {
    fail(400, { code });
    expect(await run()).toMatchObject({ ok: false, reason: "invalid_request", message: "No pudimos enviar el reemplazo. Revisa los datos y vuelve a intentarlo." });
  });
  it("maps team_action_forbidden inline on the responsible", async () => {
    fail(403, { code: "team_action_forbidden" });
    expect(await run()).toMatchObject({ ok: false, reason: "team_action_forbidden", fields: { responsible: "Solo el propietario de la empresa puede asignar a otra persona como responsable. Déjate a ti como responsable." } });
  });
  it("maps any other 403 to the permission copy", async () => {
    fail(403, { code: "forbidden" });
    expect(await run()).toMatchObject({ ok: false, reason: "forbidden", message: "No tienes permiso para iniciar un reemplazo en esta vacante." });
  });
  it.each([["not_found"], ["team_access_ended"]])("maps 404 %s", async code => {
    fail(404, { code });
    expect(await run()).toMatchObject({ ok: false, reason: "not_found", message: "No encontramos esta vacante o ya no tienes acceso." });
  });
  it("maps not_company_member inline on the responsible", async () => {
    fail(422, { code: "not_company_member" });
    expect(await run()).toMatchObject({ ok: false, reason: "not_company_member", fields: { responsible: "Esa persona ya no forma parte de tu empresa. Elige otro responsable." } });
  });
  it("maps publication_incomplete with its missing list", async () => {
    fail(422, { code: "publication_incomplete", missing: ["title_missing", "location_missing"] });
    expect(await run()).toMatchObject({
      ok: false, reason: "publication_incomplete", missing: ["title_missing", "location_missing"],
      message: "No se puede publicar al iniciar: falta completar la vacante original.",
    });
  });
  it("maps idempotency_conflict", async () => {
    fail(409, { code: "idempotency_conflict" });
    expect(await run()).toMatchObject({ ok: false, reason: "idempotency_conflict", message: "Esta solicitud ya se envió con datos distintos. Cierra el diálogo y vuelve a intentarlo." });
  });
  it.each([[412, "version_conflict"], [428, "precondition_required"]] as const)("maps %s %s and reloads", async (status, code) => {
    fail(status, { code });
    expect(await run()).toMatchObject({ ok: false, reason: code, reload: true, message: "La vacante cambió. Actualizamos su estado; revisa los datos y vuelve a confirmar." });
  });
  it("maps 401", async () => {
    fail(401, { code: "unauthenticated" });
    expect(await run()).toMatchObject({ ok: false, reason: "unauthenticated", message: "Inicia sesión para continuar." });
  });
  it.each([[500], [503]])("treats %s as an unconfirmed result", async status => {
    fail(status, { code: "internal_error" });
    expect(await run()).toMatchObject({ ok: false, reason: "server_error", uncertain: true, message: "No pudimos confirmar si se inició el reemplazo. Vuelve a intentarlo: si ya se creó, no se duplicará." });
  });
  it("treats a network failure as an unconfirmed result", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect(await run()).toMatchObject({ ok: false, reason: "no_response", uncertain: true });
  });
  it("does not trust a replacement code on the wrong status and never forwards backend text", async () => {
    fail(422, { code: "replacement_already_active", data: { process_id: ids.newDraft, root_process_id: ids.root, lifecycle } });
    const result = await run();
    expect(result).toMatchObject({ ok: false, reason: "unrecognized_response" });
    expect(JSON.stringify(result)).not.toContain("private backend text");
  });
});

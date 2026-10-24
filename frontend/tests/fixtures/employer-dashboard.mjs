// Read-only employer responses for a fixture-backed, authenticated Next server.
// This fixture does not mint sessions or bypass the application's company gate.
export const vacancyId = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const actorId = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f";
export function dashboardResponse(empty = false) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const end = Date.parse(`${today}T12:00:00Z`);
  return {
    published_vacancies: empty ? 0 : 1,
    in_process: empty ? 0 : 5,
    pool_added_last_7_days: empty ? 0 : 7,
    positions: { covered: empty ? 0 : 3, required: empty ? 0 : 5 },
    origin_by_day: Array.from({ length: 90 }, (_, i) => ({ date: new Date(end + (i - 89) * 86400000).toISOString().slice(0, 10), organic: !empty && i === 89 ? 4 : 0, manual: !empty && i === 89 ? 2 : 0 })),
    recent: empty ? [] : [
      { participation_id: vacancyId, candidate: { kind: "organic", id: actorId, name: "Ana Dashboard" }, vacancy: { id: vacancyId, title: "Plataforma Dashboard" }, stage: { id: actorId, name: "Entrevista" }, source: "organic", applied_at: "2026-10-24T01:00:00Z", added_by: null },
      { participation_id: actorId, candidate: { kind: "organic", id: actorId, name: "Luis Dashboard" }, vacancy: { id: vacancyId, title: "Plataforma Dashboard" }, stage: { id: actorId, name: "Screening" }, source: "manual", applied_at: "2026-10-23T12:00:00Z", added_by: { id: actorId, name: "María Equipo" } },
    ],
  };
}
export function dashboardVacancies(empty = false) {
  const row = { id: vacancyId, title: "Plataforma Dashboard", status: "published", process: "active", candidates: { total: 99, in_process: 5, discarded: 2, by_stage: [] }, work_mode: "remote", work_schedule: "full_time", requester: null, principal_recruiter: { id: actorId, name: "María Equipo" }, version: "1", created_at: "2026-10-20T12:00:00Z", updated_at: "2026-10-23T12:00:00Z", published_at: "2026-10-20T12:00:00Z", paused_at: null, closed_at: null, close_reason: null, close_reason_note: null, process_finished_at: null };
  return { items: empty ? [] : [row, { ...row, id: actorId, title: "Vacante pausada", status: "paused", paused_at: "2026-10-23T12:00:00Z" }], next_cursor: null };
}

export function createEmployerDashboardFixture() {
  let mode = "filled";
  return function handle(request, response, url) {
    const send = (status, body) => { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(body)); };
    if (url.pathname === "/__employer-dashboard") {
      const next = url.searchParams.get("mode");
      if (!["filled", "empty", "error", "unauthenticated", "forbidden"].includes(next)) { send(400, { error: "invalid mode" }); return true; }
      mode = next; send(200, { ok: true }); return true;
    }
    if (!["/v2/me/company/dashboard", "/v2/me/company/job-drafts"].includes(url.pathname)) return false;
    if (request.method !== "GET") { send(405, { error: "read_only", code: "invalid_request" }); return true; }
    if (!request.headers.authorization?.startsWith("Bearer ") || mode === "unauthenticated") { send(401, { error: "unauthenticated", code: "unauthenticated" }); return true; }
    if (mode === "forbidden") { send(403, { error: "forbidden", code: "forbidden" }); return true; }
    if (mode === "error") { send(500, { error: "internal_error", code: "internal_error" }); return true; }
    send(200, url.pathname.endsWith("/dashboard") ? dashboardResponse(mode === "empty") : dashboardVacancies(mode === "empty"));
    return true;
  };
}

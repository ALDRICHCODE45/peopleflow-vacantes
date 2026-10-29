import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AssessmentPage, metadata } from "./page";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: token }) }) }));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "https://api.example.test", apiTimeoutMs: 5000 } }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn(), dismissActionResult: vi.fn() }));
const token = "private-assessment-token";
const hash = "a".repeat(64);
const scale = ["No me describe nada", "Me describe poco", "Me describe a medias", "Me describe bastante", "Me describe totalmente"].map((label, i) => ({ value: i + 1, label }));
let saved: (number | null)[];
let consented: boolean;
let clock: number;
let calls: { path: string; method: string; body: unknown; init: RequestInit }[];
let failNext: { status?: number; code?: string; data?: unknown; retry?: string; network?: boolean } | undefined;
const response = (data: unknown, status = 200, headers = {}) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers });
beforeEach(() => {
  vi.stubGlobal("PointerEvent", MouseEvent); // jsdom lacks the native event Base UI dispatches.
  saved = Array(63).fill(null); consented = false; clock = 0; calls = []; failNext = undefined;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
    const path = url.pathname.replace(`/v2/assessments/${token}`, "");
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method, body, init });
    if (failNext) { const fail = failNext; failNext = undefined; if (fail.network) throw new Error(token); return response({ error: token, code: fail.code, ...(fail.data ? { data: fail.data } : {}) }, fail.status, fail.retry ? { "Retry-After": fail.retry } : {}); }
    if (path === "") return response({ company_name: "Empresa", vacancy_title: "Puesto", estimated_minutes: 10, status: "in_progress", answered_count: saved.filter(v => v !== null).length, total_count: 63, expires_at: "2099-01-01T00:00:00Z", consent: consented ? null : { notice_version: "1", text: "Aviso servido por el backend. Retención y derechos ARCO.", text_sha256: hash } });
    if (path === "/consent") { consented = true; return response(null, 204); }
    if (path === "/items") return response({ scale, items: saved.map((value, i) => ({ position: i + 1, text: `Frase ${i + 1}`, value })) });
    if (path === "/finish") return response({ status: "finished" });
    const index = Number(path.split("/").at(-1)) - 1;
    saved[index] = method === "DELETE" ? null : body.value;
    return response(null, 204);
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const click = async (name: string) => { await act(async () => { fireEvent.click(screen.getByRole("button", { name })); }); };
const choose = async (label: string) => { await act(async () => { fireEvent.click(screen.getByRole("radio", { name: label })); }); };
async function start() { consented = true; render(await AssessmentPage()); await screen.findByRole("radio", { name: scale[0].label }); }
const writes = () => calls.filter(c => c.path.startsWith("/answers/"));
function privateOutput() { expect(document.body.innerHTML).not.toContain(token); expect(document.querySelector("a[href]" )).toBeNull(); }
it("serves the exact notice before items, requires express consent and posts only its version/hash", async () => {
  render(await AssessmentPage());
  expect(screen.getByText("Aviso servido por el backend. Retención y derechos ARCO.")).toBeTruthy();
  expect(screen.queryByRole("radio")).toBeNull();
  await click("Aceptar y comenzar"); expect(calls.map(c => c.path)).toEqual([""]);
  fireEvent.click(screen.getByRole("checkbox")); await click("Aceptar y comenzar");
  expect(calls.find(c => c.path === "/consent")?.body).toEqual({ notice_version: "1", text_sha256: hash });
  expect(screen.getByText("Pregunta 1 de 63")).toBeTruthy(); privateOutput();
});
it("reloads a changed notice without accepting it or loading items", async () => {
  render(await AssessmentPage()); fireEvent.click(screen.getByRole("checkbox"));
  failNext = { status: 409, code: "notice_changed" }; await click("Aceptar y comenzar");
  expect(calls.map(c => c.path)).toEqual(["", "/consent", ""]);
  expect((screen.getByRole("checkbox") as HTMLInputElement).getAttribute("aria-checked")).toBe("false");
  expect(consented).toBe(false); privateOutput();
});
it("resumes at the first unanswered item with server scale and honest progress", async () => {
  saved[0] = 2; saved[2] = 4; await start();
  expect(screen.getByText("Pregunta 2 de 63")).toBeTruthy(); expect(screen.getByText("Frase 2")).toBeTruthy();
  expect(screen.getAllByRole("radio").map(r => r.textContent)).toHaveLength(5);
  for (const option of scale) expect(screen.getByRole("radio", { name: option.label })).toBeTruthy();
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("2"); privateOutput();
});
it("writes fresh UUID events, pauses hidden time, accumulates revisits, changes and DELETE clears", async () => {
  await start(); clock = 1000; await choose(scale[1].label);
  expect(writes()[0].body).toEqual({ event_id: expect.stringMatching(/^[a-f0-9-]{36}$/), value: 2, client_elapsed_ms: 1000 });
  clock = 1500; vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden"); fireEvent(document, new Event("visibilitychange"));
  clock = 9000; vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible"); fireEvent(document, new Event("visibilitychange"));
  clock = 9500; await click("Siguiente");
  expect(writes()[1].body).toEqual({ event_id: expect.any(String), value: 2, client_elapsed_ms: 2000 });
  clock = 10000; await click("Anterior"); clock = 11000; await choose(scale[3].label);
  expect(writes().at(-1)?.body).toEqual({ event_id: expect.any(String), value: 4, client_elapsed_ms: 3000 });
  await click("Borrar respuesta"); expect(writes().at(-1)).toMatchObject({ method: "DELETE", path: "/answers/1", body: { event_id: expect.any(String) } });
  expect(Object.keys(writes().at(-1)!.body as object)).toEqual(["event_id"]);
  expect(screen.getAllByRole("radio").every(r => r.getAttribute("aria-checked") === "false")).toBe(true);
  await choose(scale[2].label); expect(saved[0]).toBe(3);
  expect(new Set(writes().map(c => (c.body as { event_id: string }).event_id)).size).toBe(writes().length);
  privateOutput();
});
it("pauses pagehide time and resumes on pageshow without counting time away", async () => {
  await start();
  clock = 1200; fireEvent(window, new Event("pagehide"));
  clock = 10000; fireEvent(window, new Event("pageshow"));
  clock = 10800; await choose(scale[1].label);
  expect(writes()[0].body).toEqual({ event_id: expect.any(String), value: 2, client_elapsed_ms: 2000 });
  expect(saved[0]).toBe(2); privateOutput();
});
it("retries uncertain writes with the exact same body/event_id and does not advance before confirmation", async () => {
  await start(); clock = 2500; failNext = { network: true }; await choose(scale[2].label);
  expect(saved[0]).toBeNull(); expect(screen.getByText("Pregunta 1 de 63")).toBeTruthy(); privateOutput();
  clock = 5000; await click("Reintentar");
  expect(writes()[1].body).toEqual(writes()[0].body); expect(saved[0]).toBe(3);
  await click("Siguiente"); expect(screen.getByText("Pregunta 2 de 63")).toBeTruthy();
});
it("omits unavailable historical timings on saved answers rather than overwriting them with a partial visit", async () => {
  saved[0] = 4; await start(); await click("Anterior"); clock = 800; await click("Siguiente");
  expect(writes()[0].body).toEqual({ event_id: expect.any(String), value: 4 });
});
it("finishes only after all answers and shows no scores", async () => {
  saved.fill(3); saved[62] = null; await start();
  expect(screen.getByText("Pregunta 63 de 63")).toBeTruthy();
  await choose(scale[4].label); await click("Finalizar");
  expect(calls.at(-1)).toMatchObject({ path: "/finish", method: "POST", body: undefined });
  expect(screen.getByRole("heading", { name: "Gracias por responder" })).toBeTruthy();
  expect(screen.queryByText(/puntaje|percentil|score/i)).toBeNull(); privateOutput();
});
it("422 incomplete reloads saved answers and goes to the first missing position", async () => {
  saved.fill(3); await start(); failNext = undefined;
  // The final navigation saves current time before finishing; fail only the finish request.
  const fetch = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => { if (url.pathname.endsWith("/finish")) { saved[3] = null; saved[1] = null; return response({ code: "incomplete", data: { missing_positions: [4, 2] } }, 422); } return fetch(url, init); }));
  await click("Finalizar"); expect(screen.getByText("Pregunta 2 de 63")).toBeTruthy(); expect(screen.getByText("Frase 2")).toBeTruthy(); privateOutput();
});
it.each([[404, "assessment_unavailable"], [409, "invitation_closed"], [409, "assessment_finished"]])("uses the identical neutral unavailable screen for %s %s", async (status, code) => {
  await start(); failNext = { status, code }; await choose(scale[0].label);
  expect(screen.getByRole("heading", { name: "Esta evaluación no está disponible" })).toBeTruthy();
  expect(screen.queryByRole("radio")).toBeNull(); expect(saved.every(v => v === null)).toBe(true); privateOutput();
});
it("handles initial unavailable and rate limiting with Retry-After, never backend error text", async () => {
  failNext = { status: 429, code: "rate_limited", retry: "23" }; render(await AssessmentPage());
  expect(screen.getByText("Demasiados intentos, espera 23 segundos")).toBeTruthy(); privateOutput();
  failNext = { status: 404, code: "assessment_unavailable" }; await click("Reintentar");
  expect(screen.getByRole("heading", { name: "Esta evaluación no está disponible" })).toBeTruthy(); privateOutput();
});
it("preserves a clear event across a network retry and leaves the saved answer intact until accepted", async () => {
  await start(); await choose(scale[2].label);
  failNext = { network: true }; await click("Borrar respuesta");
  expect(saved[0]).toBe(3); expect(screen.getByRole("radio", { name: scale[2].label }).getAttribute("aria-checked")).toBe("true");
  const rejected = writes().at(-1); await click("Reintentar");
  expect(writes().at(-1)?.body).toEqual(rejected?.body); expect(saved[0]).toBeNull(); privateOutput();
});
it("keeps rate-limited writes unchanged and retries the same event after showing Retry-After", async () => {
  await start(); failNext = { status: 429, code: "rate_limited", retry: "17" }; await choose(scale[1].label);
  expect(screen.getByText("Demasiados intentos, espera 17 segundos")).toBeTruthy();
  expect(saved[0]).toBeNull(); const rejected = writes()[0];
  await click("Reintentar"); expect(writes()[1].body).toEqual(rejected.body); expect(saved[0]).toBe(2); privateOutput();
});
it("keeps an unanswered last item incomplete and routes to the first unanswered instead of finishing", async () => {
  saved.fill(3); saved[0] = null; saved[62] = null; await start();
  for (let index = 1; index < 63; index++) await click("Siguiente");
  expect(screen.getByText("Pregunta 63 de 63")).toBeTruthy();
  await click("Siguiente"); expect(screen.getByText("Pregunta 1 de 63")).toBeTruthy();
  expect(calls.some(c => c.path === "/finish")).toBe(false);
  expect(saved[0]).toBeNull(); expect(saved[62]).toBeNull();
});
it("follows the official choice-card composition and exposes no timer or token client prop", async () => {
  consented = true; const page = await AssessmentPage();
  expect(JSON.stringify(page.props)).not.toContain(token); render(page);
  expect(document.querySelectorAll('[data-slot="radio-group"] > [data-slot="field-label"] > [data-slot="field"] > [data-slot="radio-group-item"]').length).toBe(5);
  expect(screen.queryByRole("timer")).toBeNull(); privateOutput();
});
it("uses no-store, no-referrer, no credentials on every public backend request and private metadata", async () => {
  await start(); await choose(scale[0].label);
  await waitFor(() => expect(writes()).toHaveLength(1));
  for (const call of calls) expect(call.init).toMatchObject({ cache: "no-store", referrerPolicy: "no-referrer", credentials: "omit", redirect: "error" });
  expect(metadata).toMatchObject({ robots: { index: false, follow: false }, referrer: "no-referrer" }); privateOutput();
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AccountAssessmentPage } from "./account-page";
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: async () => "private-session" }));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "https://api.example.test", apiTimeoutMs: 5000 } }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn(), dismissActionResult: vi.fn() }));
const iid = "10000000-0000-4000-8000-000000000001";
let consented: boolean; let status: string; let foreign: boolean; let rejectWrite: boolean;
let saved: (number | null)[]; let calls: { path: string; method: string; body: unknown }[];
const hash = "a".repeat(64);
beforeEach(() => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  consented = false; status = "created"; foreign = false; rejectWrite = false; saved = Array(63).fill(null); calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer private-session");
    expect(url.pathname.startsWith(`/v2/me/assessments/${iid}`)).toBe(true);
    const path = url.pathname.slice(`/v2/me/assessments/${iid}`.length); const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined; calls.push({ path, method, body });
    const response = (data: unknown, code = 200) => new Response(code === 204 ? null : JSON.stringify(data), { status: code });
    if (foreign) return response({ code: "not_found" }, 404);
    if (method !== "GET" && rejectWrite) return response({ code: "invitation_closed" }, 409);
    if (path === "") return response({ company_name: "Empresa", vacancy_title: "Puesto", status, answered_count: saved.filter(v => v !== null).length, total_count: 63, estimated_minutes: 10, expires_at: "2099-01-01T00:00:00Z", consent: consented ? null : { notice_version: "1", text: "Aviso exacto · 12 meses · decide una persona", text_sha256: hash } });
    if (path === "/consent") { consented = true; return response(null, 204); }
    if (path === "/items") return response({ scale: [1,2,3,4,5].map(value => ({ value, label: `Opción ${value}` })), items: saved.map((value, i) => ({ position: i + 1, text: `Frase ${i + 1}`, value })) });
    if (path === "/finish") { status = "finished"; return response({ status }); }
    saved[Number(path.split("/").at(-1)) - 1] = method === "DELETE" ? null : body.value; return response(null, 204);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const click = async (role: "button" | "radio", name: string) => act(async () => { fireEvent.click(screen.getByRole(role, { name })); });
it("reuses consent → saved questions → final on the account prefix without exposing credentials or results", async () => {
  const element = await AccountAssessmentPage({ invitationId: iid });
  expect(JSON.stringify(element.props)).not.toContain("private-session"); render(element);
  expect(screen.getByText(/Aviso exacto/)).toBeVisible(); expect(screen.queryByRole("radio")).toBeNull();
  expect(screen.getByRole("link", { name: /Volver a Postulaciones/ })).toHaveAttribute("href", "/candidato/postulaciones");
  expect(screen.queryByText(/No necesitas crear una cuenta/)).toBeNull();
  fireEvent.click(screen.getByRole("checkbox")); await click("button", "Aceptar y comenzar");
  expect(calls.find(c => c.path === "/consent")?.body).toEqual({ notice_version: "1", text_sha256: hash });
  await click("radio", "Opción 3"); expect(saved[0]).toBe(3);
  await click("button", "Borrar respuesta"); expect(saved[0]).toBeNull();
  expect(calls.at(-1)).toMatchObject({ method: "DELETE", path: "/answers/1" });
  cleanup(); saved.fill(3); render(await AccountAssessmentPage({ invitationId: iid }));
  await click("button", "Finalizar"); expect(screen.getByRole("heading", { name: "Gracias por responder" })).toBeVisible();
  expect(document.body).not.toHaveTextContent(/puntaje|score|percentil|private-session/);
});
it.each(["expired", "revoked"])("renders %s read-only even when consent is outstanding", async closed => {
  status = closed; render(await AccountAssessmentPage({ invitationId: iid }));
  expect(screen.getByRole("heading", { name: "Ya no está disponible" })).toBeVisible();
  expect(screen.queryByRole("checkbox")).toBeNull(); expect(screen.queryByRole("radio")).toBeNull(); expect(calls).toHaveLength(1);
});
it("keeps finished invitations read-only and never fetches items/results", async () => {
  status = "finished"; render(await AccountAssessmentPage({ invitationId: iid }));
  expect(screen.getByRole("heading", { name: "Gracias por responder" })).toBeVisible(); expect(calls).toHaveLength(1); expect(screen.queryByRole("checkbox")).toBeNull();
});
it("uses a neutral foreign-iid screen with no items or writes", async () => {
  foreign = true; render(await AccountAssessmentPage({ invitationId: iid }));
  expect(screen.getByRole("heading", { name: "Ya no está disponible" })).toBeVisible(); expect(calls).toHaveLength(1); expect(saved.every(v => v === null)).toBe(true);
});
it("closes neutrally on invitation_closed and preserves saved answers", async () => {
  consented = true; render(await AccountAssessmentPage({ invitationId: iid })); rejectWrite = true;
  await click("radio", "Opción 3"); expect(screen.getByRole("heading", { name: "Ya no está disponible" })).toBeVisible();
  expect(saved.every(v => v === null)).toBe(true); expect(screen.queryByRole("radio")).toBeNull();
});

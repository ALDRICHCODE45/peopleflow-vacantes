import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "https://api.example.test", apiTimeoutMs: 100 } }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "192.0.2.10", cookie: "next-auth.session-token=private", authorization: "Bearer private" })),
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
import Page, { dynamic, metadata } from "./page";

const SECRET = "s".repeat(40);
const TOKEN = "v1.AbC-123_xyz.Sig_nature-9";
const fetchMock = vi.fn();
const state = (overrides: object = {}) => ({ type: "application_received", channel: "email", enabled: true, company: { id: "c-1", name: "Acme" }, ...overrides });
const envelope = (status: number, code: string, headers: Record<string, string> = {}) =>
  Response.json({ error: "private backend message", code }, { status, headers });
const methods = () => fetchMock.mock.calls.map(([, init]) => (init as RequestInit).method ?? "GET");
const show = async (...args: [] | [string | string[] | undefined]) => {
  const token = args.length ? args[0] : TOKEN;
  return render(await Page({ searchParams: Promise.resolve(token === undefined ? {} : { token }) }));
};
const link = (name: string) => screen.getByRole("link", { name });

beforeEach(() => { vi.clearAllMocks(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); vi.stubEnv("AUDIT_PROXY_SECRET", SECRET); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("is never indexed, never cached and sends no referrer", () => {
  expect(metadata).toMatchObject({ robots: { index: false, follow: false }, referrer: "no-referrer" });
  expect(dynamic).toBe("force-dynamic");
});

describe("valid link", () => {
  it("shows what the link turns off and the current state, reading with GET only (proxy headers, no session)", async () => {
    fetchMock.mockResolvedValue(Response.json(state()));
    await show();
    expect(screen.getByRole("heading", { name: "Dejar de recibir por correo: Nueva postulación de Acme" })).toBeInTheDocument();
    expect(screen.getByText("Hoy recibes este aviso por correo.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dejar de recibir" })).toBeEnabled();
    expect(methods()).toEqual(["GET"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`https://api.example.test/v2/notifications/unsubscribe?token=${TOKEN}`);
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get("x-pf-proxy-secret")).toBe(SECRET);
    expect(headers.get("x-pf-client-ip")).toBe("192.0.2.10");
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("authorization")).toBeNull();
  });

  it("names the type without a company for candidate links", async () => {
    fetchMock.mockResolvedValue(Response.json(state({ type: "candidate_message_received", company: null })));
    await show();
    expect(screen.getByRole("heading", { name: "Dejar de recibir por correo: Mensajes de las empresas" })).toBeInTheDocument();
  });

  it("confirms through POST and links to the company preferences", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(state())).mockResolvedValueOnce(Response.json(state({ enabled: false })));
    await show();
    await userEvent.click(screen.getByRole("button", { name: "Dejar de recibir" }));
    expect(await screen.findByRole("heading", { name: "Listo. Ya no recibirás este tipo de correo." })).toBeInTheDocument();
    expect(link("Ajustar mis preferencias")).toHaveAttribute("href", "/empresa/configuracion/notificaciones");
    expect(methods()).toEqual(["GET", "POST"]);
    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toBe(`https://api.example.test/v2/notifications/unsubscribe?token=${TOKEN}`);
    expect(new TextDecoder().decode((init as RequestInit).body as Uint8Array)).toBe("List-Unsubscribe=One-Click");
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get("x-pf-proxy-secret")).toBe(SECRET);
    expect(headers.get("cookie")).toBeNull();
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it("links a candidate to the candidate preferences after confirming", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(state({ type: "candidate_test_pending", company: null })))
      .mockResolvedValueOnce(Response.json(state({ type: "candidate_test_pending", company: null, enabled: false })));
    await show();
    await userEvent.click(screen.getByRole("button", { name: "Dejar de recibir" }));
    expect(await screen.findByRole("link", { name: "Ajustar mis preferencias" })).toHaveAttribute("href", "/candidato/configuracion/notificaciones");
  });

  it.each([
    [() => envelope(429, "rate_limited", { "retry-after": "60" }), "Demasiados intentos. Inténtalo en unos minutos."],
    [() => envelope(503, "internal_error"), "No se cambió nada. Inténtalo de nuevo."],
  ])("keeps the confirm button for a retry when the POST fails", async (answer, message) => {
    fetchMock.mockResolvedValueOnce(Response.json(state())).mockResolvedValueOnce(answer());
    await show();
    await userEvent.click(screen.getByRole("button", { name: "Dejar de recibir" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "Dejar de recibir" })).toBeEnabled();
  });

  it("shows the invalid link when the POST says the link is no longer valid", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(state())).mockResolvedValueOnce(envelope(422, "unsubscribe_link_invalid"));
    await show();
    await userEvent.click(screen.getByRole("button", { name: "Dejar de recibir" }));
    expect(await screen.findByRole("heading", { name: "Este enlace ya no es válido." })).toBeInTheDocument();
  });
});

it("says the email is already off without a confirm button", async () => {
  fetchMock.mockResolvedValue(Response.json(state({ enabled: false })));
  await show();
  expect(screen.getByRole("heading", { name: "Ya no recibes este tipo de correo." })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Dejar de recibir" })).toBeNull();
  expect(link("Ajustar mis preferencias")).toHaveAttribute("href", "/empresa/configuracion/notificaciones");
  expect(methods()).toEqual(["GET"]);
});

describe("invalid link", () => {
  it("shows the backend's 422 with both preferences links", async () => {
    fetchMock.mockResolvedValue(envelope(422, "unsubscribe_link_invalid"));
    await show();
    expect(screen.getByRole("heading", { name: "Este enlace ya no es válido." })).toBeInTheDocument();
    expect(link("Preferencias de empresa")).toHaveAttribute("href", "/empresa/configuracion/notificaciones");
    expect(link("Preferencias de candidato")).toHaveAttribute("href", "/candidato/configuracion/notificaciones");
    expect(screen.queryByRole("button", { name: "Dejar de recibir" })).toBeNull();
    expect(methods()).toEqual(["GET"]);
  });

  it.each([undefined, "", "bad token", "A".repeat(513), ["a", "b"]])("treats a missing or malformed token %j as invalid without a request", async token => {
    await show(token);
    expect(screen.getByRole("heading", { name: "Este enlace ya no es válido." })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

it("shows the rate limit for a 429 GET", async () => {
  fetchMock.mockResolvedValue(envelope(429, "rate_limited", { "retry-after": "60" }));
  await show();
  expect(screen.getByRole("heading", { name: "Demasiados intentos. Inténtalo en unos minutos." })).toBeInTheDocument();
  expect(methods()).toEqual(["GET"]);
});

it.each([
  ["a 5xx", () => fetchMock.mockResolvedValue(envelope(500, "internal_error"))],
  ["a network failure", () => fetchMock.mockRejectedValue(new TypeError("fetch failed"))],
])("offers a generic retry for %s that reloads without posting", async (_, arrange) => {
  arrange();
  await show();
  expect(screen.getByRole("heading", { name: "No pudimos abrir este enlace." })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  expect(refresh).toHaveBeenCalledOnce();
  expect(methods()).toEqual(["GET"]);
});

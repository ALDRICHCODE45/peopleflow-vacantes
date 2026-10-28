import * as React from "react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync, existsSync } from "node:fs";
import { loadCareersEditor } from "./actions";
import type { CareersEditorResult } from "./actions";
import Page, { metadata } from "./page";
import { StateCard } from "@/components/feedback/state-card";
import { CircleAlert } from "lucide-react";

vi.mock("./actions", () => ({ loadCareersEditor: vi.fn() }));
vi.mock("@/components/company-dashboard/site-header", () => ({ SiteHeader: ({ title }: { title: string }) => <header>{title}</header> }));
vi.mock("@/features/company-site/editor", () => ({
  CareersSiteEditorLoading: () => <p role="status">Cargando editor</p>,
  CareersSiteEditorError: ({ onRetry }: { onRetry: () => void }) => <StateCard icon={CircleAlert} tone="error" title="No pudimos cargar el editor" description="Reintenta" primaryAction={{ label: "Reintentar", onClick: onRetry }} />,
  CareersSiteEditor: ({ initialSite, role, preview }: { initialSite: { draft_version: number }; role: string; preview: { company: { name: string } } }) => <section aria-label="Editor">{role} · versión {initialSite.draft_version} · {preview.company.name}</section>,
}));
const success = { ok: true, site: { draft_version: 7 }, role: "owner", preview: { company: { name: "Empresa real" } } } as CareersEditorResult;
beforeEach(() => { vi.resetAllMocks(); vi.mocked(loadCareersEditor).mockResolvedValue(success); });
afterEach(cleanup);
it("keeps metadata and the shared content shell", async () => {
  const { container } = render(<Page />);
  expect(metadata.title).toBe("Sitio de empleo");
  expect(container.querySelector("[data-pf-page-content] header")).toBeNull();
  expect(container.querySelector("[data-pf-sitio-content]")).toBeInTheDocument();
  expect(await screen.findByRole("region", { name: "Editor" })).toHaveTextContent("owner · versión 7 · Empresa real");
});
it("passes the recruiter role", async () => {
  vi.mocked(loadCareersEditor).mockResolvedValue({ ...success, role: "recruiter" } as CareersEditorResult);
  render(<Page />);
  expect(await screen.findByRole("region", { name: "Editor" })).toHaveTextContent("recruiter");
});
it.each([
  ["forbidden", "No tienes acceso al sitio de empleo"],
  ["company_inactive", "La empresa está inactiva"],
  ["unauthenticated", "Tu sesión expiró"],
  ["unavailable", "No pudimos cargar el editor"],
] as const)("renders %s without the editor", async (code, title) => {
  vi.mocked(loadCareersEditor).mockResolvedValue({ ok: false, code });
  render(<Page />);
  expect(await screen.findByRole("heading", { name: title })).toBeVisible();
  expect(screen.queryByRole("region", { name: "Editor" })).toBeNull();
  if (code === "forbidden") expect(screen.getByRole("link", { name: "Volver al dashboard" })).toHaveAttribute("href", "/empresa/dashboard");
  if (code === "unauthenticated") expect(screen.getByRole("link", { name: "Iniciar sesión" })).toHaveAttribute("href", "/empresa/login");
});
it("renders the skeleton pending and loads only once in StrictMode", async () => {
  let resolve!: (value: CareersEditorResult) => void;
  vi.mocked(loadCareersEditor).mockReturnValue(new Promise(done => { resolve = done; }));
  render(<StrictMode><Page /></StrictMode>);
  expect(screen.getByRole("status")).toHaveTextContent("Cargando editor");
  expect(loadCareersEditor).toHaveBeenCalledTimes(1);
  resolve(success);
  expect(await screen.findByRole("region", { name: "Editor" })).toBeVisible();
});
it("retries a rejected action without exposing its error", async () => {
  vi.mocked(loadCareersEditor).mockRejectedValueOnce(new Error("private diagnostic"));
  render(<Page />);
  fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
  await waitFor(() => expect(loadCareersEditor).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole("region", { name: "Editor" })).toBeVisible();
  expect(screen.queryByText("private diagnostic")).toBeNull();
});
it("keeps a server page without prototype imports or a route loading boundary", () => {
  const source = readFileSync("src/app/(empresa)/empresa/sitio/page.tsx", "utf8");
  expect(source).not.toContain("company-site-editor");
  expect(source).not.toContain("use client");
  expect(existsSync("src/app/(empresa)/empresa/sitio/loading.tsx")).toBe(false);
});

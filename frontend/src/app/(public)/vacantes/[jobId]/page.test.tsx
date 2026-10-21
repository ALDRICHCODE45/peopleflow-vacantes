import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { legacyDetail, vacancyDetail } from "../../../../features/jobs/api/public-fixtures";
import { createVacanteDetailScope } from "./page-data";
import Page, { generateMetadata } from "./page";
import NotFound from "./not-found";
import ErrorBoundary from "./error";
vi.mock("../../../../lib/api/server", async () => ({ requestJson: (await import("../../../../lib/api/requestJson")).requestJson }));
vi.mock("../../../../lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://127.0.0.1:8080", siteUrl: "http://127.0.0.1:3000", apiTimeoutMs: 8000 } }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
const params = (jobId: string) => Promise.resolve({ jobId });
const response = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("public detail route", () => {
  it.each(["paused", "closed"])("renders and noindexes %s vacancies", async availability => {
    const data = { id: vacancyDetail.id, title: vacancyDetail.title, company: { id: vacancyDetail.company.id, name: vacancyDetail.company.name }, availability };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "Unavailable", code: "vacancy_unavailable", data }, 410)));
    expect(await createVacanteDetailScope().read(data.id)).toEqual({ kind: "unavailable_vacancy", vacancy: data });
    expect(await generateMetadata({ params: params(data.id) })).toEqual({ title: data.title, robots: { index: false, follow: true } });
    render(await Page({ params: params(data.id) }));
    expect(screen.getByRole("heading", { name: availability === "paused" ? "Vacante pausada" : "Vacante cerrada" }).closest('[data-slot="card"]')).not.toBeNull();
    expect(screen.getByText(new RegExp(data.title))).toBeVisible();
    expect(screen.getByRole("link", { name: "Ver otras vacantes" })).toHaveAttribute("href", "/vacantes");
  });
  it.each([409, 500])("does not treat a lifecycle envelope on HTTP %i as an unavailable vacancy", async status => {
    const data = { id: vacancyDetail.id, title: "Backend Go", company: { id: vacancyDetail.company.id, name: "Acme" }, availability: "paused" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "Unavailable", code: "vacancy_unavailable", data }, status)));
    expect(await createVacanteDetailScope().read(data.id)).toMatchObject({ kind: "unavailable" });
    expect(await generateMetadata({ params: params(data.id) })).toEqual({});
  });
  it("stays a dynamic server page with a local not-found mapping and no enrichment", () => {
    const source = readFileSync(join(process.cwd(), "src/app/(public)/vacantes/[jobId]/page.tsx"), "utf8");
    expect(source).toMatch(/dynamic\s*=\s*"force-dynamic"/);
    expect(source).toMatch(/runtime\s*=\s*"nodejs"/);
    expect(source).not.toMatch(/requestJson|use client|enrichJob|QueryClientProvider|HydrationBoundary/);
    expect(source).toContain("metaDescription(result.job.description_plain)");
  });
  it.each([legacyDetail, vacancyDetail])("renders $source contract data without fictional extras", async (job) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(job)));
    const { container } = render(await Page({ params: params(job.id) }));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(job.title);
    expect(container).not.toHaveTextContent(/Hace 2 h|Hace 5 h|Verificada por|Postulantes/);
    expect(screen.getByRole("link", { name: "Volver a vacantes" })).toHaveAttribute("href", "/vacantes");
  });
  it("uses plain text for SEO even when the description is rich", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(vacancyDetail)));
    const meta = await generateMetadata({ params: params(vacancyDetail.id) });
    expect(meta.title).toBe(vacancyDetail.title);
    expect(meta.description).toBe(vacancyDetail.description_plain);
    expect(meta.alternates?.canonical).toBe(`http://127.0.0.1:3000/vacantes/${vacancyDetail.id}`);
  });
  it("rejects malformed and backend 404 ids but never masks schema/service errors as 404", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(Page({ params: params("nope") })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(response({ error: "not found", code: "not_found" }, 404));
    await expect(Page({ params: params(vacancyDetail.id) })).rejects.toThrow("NEXT_NOT_FOUND");
    fetchMock.mockResolvedValue(response({}, 500));
    await expect(Page({ params: params(vacancyDetail.id) })).rejects.toThrow("La vacante no pudo cargarse");
    fetchMock.mockResolvedValue(response({ ...vacancyDetail, seniority: "staff" }));
    await expect(Page({ params: params(vacancyDetail.id) })).rejects.toThrow("La vacante no pudo cargarse");
  });
  it("keeps the shared not-found heading and a path back", () => {
    const { container } = render(<NotFound />);
    expect(container.querySelector('[data-slot="empty"]')).not.toBeNull();
    // Exploring other vacancies remains the primary way out.
    const explore = screen.getByRole("link", { name: "Explorar vacantes" });
    expect(explore).toHaveClass("min-h-10", "bg-primary");
    expect(explore).toHaveAttribute("href", "/vacantes");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Esta vacante no está disponible");
  });
  it("keeps the error boundary distinct with the shared heading and a retry", () => {
    const reset = vi.fn();
    const { container } = render(<ErrorBoundary error={new Error("upstream")} reset={reset} />);
    expect(container.querySelector('[data-slot="empty"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Reintentar" })).toHaveClass("min-h-10");
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("No se pudo cargar la vacante");
    // Recovery and the quieter alternative share EmptyContent.
    const retry = screen.getByRole("button", { name: "Reintentar" });
    expect(retry).toHaveClass("bg-primary");
    const back = screen.getByRole("link", { name: "Ver vacantes" });
    expect(back).not.toHaveClass("bg-primary");
    expect(back.closest('[data-slot="empty-content"]')).not.toBeNull();
    fireEvent.click(retry);
    expect(reset).toHaveBeenCalledOnce();
    expect(screen.queryByText("Esta vacante no está disponible")).toBeNull();
  });
  it("deduplicates concurrent page/metadata reads inside a scope and isolates requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(vacancyDetail));
    vi.stubGlobal("fetch", fetchMock);
    const scope = createVacanteDetailScope();
    const [page, meta] = await Promise.all([scope.read(vacancyDetail.id), scope.metadata(vacancyDetail.id)]);
    expect(page).toEqual({ kind: "found", job: vacancyDetail });
    expect(meta).toEqual(page);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await createVacanteDetailScope().read(vacancyDetail.id);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

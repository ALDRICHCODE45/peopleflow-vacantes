import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import { JobsNavigationIsland } from "../../../../features/jobs/components/JobsNavigationIsland";
import { legacyDetail, listItem } from "../../../../features/jobs/api/public-fixtures";

const { push, redirect, read } = vi.hoisted(() => ({ push: vi.fn(), redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }), read: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), redirect }));
vi.mock("../../../../features/jobs/api/listJobs", () => ({ listJobsQueryOptions: (query: unknown) => ({ queryKey: ["jobs", query], queryFn: read }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const vacancyList = <ul aria-label="Listado de vacantes" />;

describe("/vacantes v2 page", () => {
  it("describes the actual public filters without claiming a tech-only catalog", () => {
    const source = readFileSync(join(process.cwd(), "src/app/(candidato)/vacantes/(listado)/page.tsx"), "utf8").replace(/\s+/g, " ");
    expect(source).toContain("Bolsa de trabajo");
    expect(source).toContain("Encuentra tu próximo trabajo");
    expect(source).toContain("Explora vacantes publicadas y filtra por ubicación, modalidad, jornada, tipo de contrato y área profesional.");
    expect(source).not.toMatch(/senioridad|moneda|en tech|tiempo real/i);
  });
  it("redirects stale, invalid and duplicate filters before the query function runs", async () => {
    const Page = (await import("./page")).default;
    await expect(Page({ searchParams: Promise.resolve({ q: " Go ", currency: "MXN", language: "en", work_schedule: ["full_time", "part_time"], contract_type: "bad", work_mode: "hybrid" }) })).rejects.toThrow("redirect:/vacantes?q=Go&work_mode=hybrid");
    expect(read).not.toHaveBeenCalled();
  });
  it("renders valid public results from one request-scoped read", async () => {
    read.mockResolvedValue({ ok: true, data: { items: [listItem(legacyDetail)], next_cursor: null } });
    const Page = (await import("./page")).default;
    render(await Page({ searchParams: Promise.resolve({ work_mode: "remote" }) }));
    expect(read).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: legacyDetail.title })).toBeVisible();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Encuentra tu próximo trabajo");
  });
  it("renders only supported quick filters through the installed toggle group", () => {
    const { container } = render(<JobsNavigationIsland routeKey="/vacantes" query={{}}>{vacancyList}</JobsNavigationIsland>);
    for (const label of ["Todas", "Remoto", "Híbrido", "Tiempo completo"]) expect(screen.getByRole("button", { name: label })).toBeVisible();
    for (const label of ["Medio", "Senior"]) expect(screen.queryByRole("button", { name: label })).toBeNull();
    expect(container.querySelector('[data-slot="toggle-group"]')).not.toBeNull();
  });
  it("makes quick filter state reflect the URL and commits without a stale cursor", () => {
    render(<JobsNavigationIsland routeKey="/vacantes?contract_type=indefinite&cursor=old" query={{ contract_type: "indefinite", cursor: "old" }}>{vacancyList}</JobsNavigationIsland>);
    expect(screen.getByRole("button", { name: "Todas" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Remoto" }));
    expect(push).toHaveBeenCalledWith("/vacantes?work_mode=remote&contract_type=indefinite");
  });
});

describe("/vacantes synchronous boundaries", () => {
  it("keeps the client route error with the shared heading and a reset action", async () => {
    const ErrorBoundary = (await import("../error")).default;
    const reset = vi.fn();
    const { container } = render(<ErrorBoundary error={new Error("upstream")} reset={reset} />);
    expect(container.querySelector('[data-slot="empty"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Reintentar" })).toHaveClass("min-h-10");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudieron cargar las vacantes");
    expect(screen.getByText("No se mostró ninguna vacante. Vuelve a intentarlo; si el problema sigue, prueba de nuevo en unos minutos.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Reintentar" })).toHaveClass("bg-primary");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(reset).toHaveBeenCalledOnce();
  });
  it.each(["Buscar", "Aplicar filtros"])("announces and isolates pending %s navigation", (label) => {
    const fixture = (routeKey: string) => <JobsNavigationIsland routeKey={routeKey}>
      <form action="/vacantes?q=pending-search"><button>Buscar</button></form>
      <form action="/vacantes?contract_type=indefinite"><button>Aplicar filtros</button></form>
      <Link href="/vacantes?cursor=opaque">Ver más vacantes</Link>
    </JobsNavigationIsland>;
    const { rerender } = render(fixture("/vacantes"));
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(screen.getByRole("status")).toHaveTextContent("Cargando…");
    expect(screen.getByRole("button", { name: label })).toBeDisabled();
    expect(screen.getByRole("button", { name: label === "Buscar" ? "Aplicar filtros" : "Buscar" })).toBeEnabled();
    expect(push).toHaveBeenCalledWith(label === "Buscar" ? "/vacantes?q=pending-search" : "/vacantes?contract_type=indefinite");
    rerender(fixture("/vacantes?q=new"));
    expect(screen.getByRole("status")).not.toHaveTextContent("Cargando…");
    expect(screen.getByRole("button", { name: label })).toBeEnabled();
  });
  it("marks only the next link busy and preserves surrounding controls", () => {
    render(<JobsNavigationIsland routeKey="/vacantes"><button>Buscar</button><Link href="/vacantes?cursor=opaque">Ver más vacantes</Link></JobsNavigationIsland>);
    const link = screen.getByRole("link", { name: "Ver más vacantes" });
    fireEvent.click(link);
    expect(link).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Buscar" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("Cargando…");
    expect(push).toHaveBeenCalledWith("/vacantes?cursor=opaque");
  });
});

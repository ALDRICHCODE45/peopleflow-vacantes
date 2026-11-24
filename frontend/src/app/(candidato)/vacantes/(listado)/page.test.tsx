import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import { JobsNavigationIsland } from "../../../../features/jobs/components/JobsNavigationIsland";
import { legacyDetail, listItem } from "../../../../features/jobs/api/public-fixtures";

const { push, redirect, read } = vi.hoisted(() => ({ push: vi.fn(), redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }), read: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), redirect }));
vi.mock("../../../../features/jobs/api/listJobs", () => ({ listJobsQueryOptions: (query: unknown) => ({ queryKey: ["jobs", query], queryFn: read }) }));
const reload = vi.hoisted(() => ({ reloadPage: vi.fn() }));
vi.mock("@/features/jobs/components/reload-page", () => reload);
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const vacancyList = <ul aria-label="Listado de vacantes" />;

describe("/vacantes v2 page", () => {
  it("titles the tab «Vacantes de empleo» (the root template appends «| PeopleFlow»)", async () => {
    const { metadata } = await import("./page");
    expect(metadata.title).toBe("Vacantes de empleo");
    expect(metadata.description).toMatch(/filtra por ubicación/u);
  });
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
  it("keeps guardar when redirecting non-canonical filters before reading", async () => {
    const Page = (await import("./page")).default;
    await expect(Page({ searchParams: Promise.resolve({ q: " Go ", guardar: legacyDetail.id }) })).rejects.toThrow(`redirect:/vacantes?q=Go&guardar=${legacyDetail.id}`);
    expect(read).not.toHaveBeenCalled();
  });
  it("does not redirect canonical filters with guardar", async () => {
    read.mockResolvedValue({ ok: true, data: { items: [listItem(legacyDetail)], next_cursor: null } });
    const Page = (await import("./page")).default;
    render(await Page({ searchParams: Promise.resolve({ work_mode: "remote", guardar: legacyDetail.id }) }));
    expect(redirect).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: legacyDetail.title })).toBeVisible();
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
    const chips = within(screen.getByRole("group", { name: "Filtros rápidos" })).getAllByRole("button").map(chip => chip.textContent);
    expect(chips).toEqual(["Todas", "Presencial", "Híbrido", "Remoto"]);
    for (const label of ["Medio", "Senior", "Tiempo completo"]) expect(screen.queryByRole("button", { name: label })).toBeNull();
    expect(container.querySelector('[data-slot="toggle-group"]')).not.toBeNull();
  });
  it("commits «Presencial» as the onsite modality", () => {
    render(<JobsNavigationIsland routeKey="/vacantes" query={{}}>{vacancyList}</JobsNavigationIsland>);
    fireEvent.click(screen.getByRole("button", { name: "Presencial" }));
    expect(push).toHaveBeenCalledWith("/vacantes?work_mode=onsite");
  });
  it("makes quick filter state reflect the URL and commits without a stale cursor", () => {
    render(<JobsNavigationIsland routeKey="/vacantes?contract_type=indefinite&cursor=old" query={{ contract_type: "indefinite", cursor: "old" }}>{vacancyList}</JobsNavigationIsland>);
    expect(screen.getByRole("button", { name: "Todas" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Remoto" }));
    expect(push).toHaveBeenCalledWith("/vacantes?work_mode=remote&contract_type=indefinite");
  });
});

describe("/vacantes synchronous boundaries", () => {
  it("keeps the client route error with the shared heading and a reload retry", async () => {
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
    expect(reload.reloadPage).toHaveBeenCalledOnce();
    expect(reset).not.toHaveBeenCalled();
  });
  it.each(["Buscar", "Aplicar filtros"])("announces and isolates pending %s navigation", (label) => {
    const fixture = (routeKey: string) => <JobsNavigationIsland routeKey={routeKey}>
      <form action="/vacantes?q=pending-search"><button>Buscar</button></form>
      <form action="/vacantes?contract_type=indefinite"><button>Aplicar filtros</button></form>
      <Link href="/vacantes?cursor=opaque">Ver más vacantes</Link>
    </JobsNavigationIsland>;
    const { rerender } = render(fixture("/vacantes"));
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(screen.getByRole("status")).toHaveTextContent("Cargando vacantes");
    // Announced only: the visible cue is the spinner over the results.
    expect(screen.getByRole("status")).toHaveClass("sr-only");
    expect(screen.getByRole("button", { name: label })).toBeDisabled();
    expect(screen.getByRole("button", { name: label === "Buscar" ? "Aplicar filtros" : "Buscar" })).toBeEnabled();
    expect(push).toHaveBeenCalledWith(label === "Buscar" ? "/vacantes?q=pending-search" : "/vacantes?contract_type=indefinite");
    rerender(fixture("/vacantes?q=new"));
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(screen.getByRole("button", { name: label })).toBeEnabled();
  });
  it("marks only the next link busy and preserves surrounding controls", () => {
    render(<JobsNavigationIsland routeKey="/vacantes"><button>Buscar</button><Link href="/vacantes?cursor=opaque">Ver más vacantes</Link></JobsNavigationIsland>);
    const link = screen.getByRole("link", { name: "Ver más vacantes" });
    fireEvent.click(link);
    expect(link).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Buscar" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("Cargando vacantes");
    expect(push).toHaveBeenCalledWith("/vacantes?cursor=opaque");
  });
  it("centers a spinner over the dimmed results while a filter navigation is pending", () => {
    const fixture = (routeKey: string) => <JobsNavigationIsland routeKey={routeKey} query={{}}>{vacancyList}</JobsNavigationIsland>;
    const { container, rerender } = render(fixture("/vacantes"));
    const results = container.querySelector("[data-jobs-results]")!;
    expect(results).not.toHaveAttribute("aria-busy");
    expect(results.querySelector('[data-slot="spinner"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remoto" }));
    expect(results).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("list", { name: "Listado de vacantes" }).parentElement).toHaveClass("opacity-50");
    const spinner = results.querySelector('[data-slot="spinner"]')!;
    expect(spinner).toHaveAttribute("aria-hidden", "true");
    // Centered over the results, never blocking them.
    expect(spinner.closest("[data-jobs-results-pending]")).toHaveClass("pointer-events-none", "absolute", "inset-0", "justify-center");
    expect(screen.getByRole("status")).toHaveTextContent("Cargando vacantes");
    expect(screen.queryByText("Cargando…")).toBeNull();
    rerender(fixture("/vacantes?work_mode=remote"));
    expect(results).not.toHaveAttribute("aria-busy");
    expect(results.querySelector('[data-slot="spinner"]')).toBeNull();
    expect(screen.getByRole("list", { name: "Listado de vacantes" }).parentElement).not.toHaveClass("opacity-50");
  });
  it("leaves the next-page cue to its own link instead of covering the results", () => {
    const { container } = render(<JobsNavigationIsland routeKey="/vacantes" query={{}}>{vacancyList}<Link href="/vacantes?cursor=opaque" data-jobs-next-link="true">Ver más vacantes</Link></JobsNavigationIsland>);
    fireEvent.click(screen.getByRole("link", { name: "Ver más vacantes" }));
    expect(screen.getByRole("link", { name: "Ver más vacantes" })).toHaveAttribute("aria-busy", "true");
    const results = container.querySelector("[data-jobs-results]")!;
    expect(results).toHaveAttribute("aria-busy", "true");
    expect(results.querySelector("[data-jobs-results-pending]")).toBeNull();
    expect(screen.getByRole("list", { name: "Listado de vacantes" }).parentElement).not.toHaveClass("opacity-50");
    expect(screen.getByRole("status")).toHaveTextContent("Cargando vacantes");
  });
  it("shows the total in the heading only when the payload has it («1000+» when capped)", async () => {
    const Page = (await import("./page")).default;
    read.mockResolvedValue({ ok: true, data: { items: [listItem(legacyDetail)], next_cursor: null } });
    const { container, unmount } = render(await Page({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { name: "Vacantes disponibles" })).toBeVisible();
    expect(container.querySelector("[data-jobs-total]")).toBeNull();
    unmount();
    read.mockResolvedValue({ ok: true, data: { items: [listItem(legacyDetail)], next_cursor: null, total: { count: 137, capped: false } } });
    const withTotal = render(await Page({ searchParams: Promise.resolve({}) }));
    expect(withTotal.container.querySelector("[data-jobs-total]")).toHaveTextContent("137 vacantes");
    withTotal.unmount();
    read.mockResolvedValue({ ok: true, data: { items: [listItem(legacyDetail)], next_cursor: null, total: { count: 1000, capped: true } } });
    const capped = render(await Page({ searchParams: Promise.resolve({}) }));
    expect(capped.container.querySelector("[data-jobs-total]")).toHaveTextContent("1000+ vacantes");
  });
  it("redirects an invalid sort to the canonical URL and reads with a valid one", async () => {
    const Page = (await import("./page")).default;
    await expect(Page({ searchParams: Promise.resolve({ q: "Go", sort: "price" }) })).rejects.toThrow("redirect:/vacantes?q=Go");
    await expect(Page({ searchParams: Promise.resolve({ sort: "recent" }) })).rejects.toThrow("redirect:/vacantes");
    expect(read).not.toHaveBeenCalled();
    read.mockResolvedValue({ ok: true, data: { items: [listItem(legacyDetail)], next_cursor: null } });
    render(await Page({ searchParams: Promise.resolve({ sort: "salary_desc" }) }));
    expect(read).toHaveBeenCalledOnce();
  });
  it("offers the three sorts, marks the current one, and changing it navigates without the cursor", () => {
    render(<JobsNavigationIsland routeKey="/vacantes?q=Go&sort=salary_desc&cursor=old" query={{ q: "Go", sort: "salary_desc", cursor: "old" }} total={{ count: 12, capped: false }}>{vacancyList}</JobsNavigationIsland>);
    const group = screen.getByRole("group", { name: "Ordenar vacantes" });
    expect(within(group).getAllByRole("button").map(item => item.textContent)).toEqual(["Recientes", "Mayor salario", "Menor salario"]);
    expect(within(group).getByRole("button", { name: "Mayor salario" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(group).getByRole("button", { name: "Menor salario" }));
    expect(push).toHaveBeenCalledWith("/vacantes?q=Go&sort=salary_asc");
  });
  it("choosing «Recientes» drops sort from the URL; the sort is not a filter (Todas stays active, no count)", () => {
    render(<JobsNavigationIsland routeKey="/vacantes?sort=salary_asc" query={{ sort: "salary_asc" }} total={{ count: 12, capped: false }}>{vacancyList}</JobsNavigationIsland>);
    expect(within(screen.getByRole("group", { name: "Filtros rápidos" })).getByRole("button", { name: "Todas" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Filtros" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Recientes" }));
    expect(push).toHaveBeenCalledWith("/vacantes");
  });
  it("hides the sort control when the response carries no total (a backend without sort), even with ?sort= in the URL", () => {
    render(<JobsNavigationIsland routeKey="/vacantes?sort=salary_desc" query={{ sort: "salary_desc" }}>{vacancyList}</JobsNavigationIsland>);
    expect(screen.queryByRole("group", { name: "Ordenar vacantes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mayor salario" })).toBeNull();
  });
  it("hides the sort control when the total is zero", () => {
    render(<JobsNavigationIsland routeKey="/vacantes" query={{}} total={{ count: 0, capped: false }}>{vacancyList}</JobsNavigationIsland>);
    expect(screen.queryByRole("group", { name: "Ordenar vacantes" })).toBeNull();
  });
});

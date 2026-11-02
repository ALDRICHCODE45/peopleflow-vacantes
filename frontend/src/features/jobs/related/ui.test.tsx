import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { legacyDetail, listItem, vacancyDetail } from "../api/public-fixtures";
import { PublicJobDetailView } from "../components/PublicJobDetailView";
import { CompanySection, CompanySkeleton, SimilarSection, SimilarSkeleton, RelatedSearches, MobileApplyBar, ExploreDetail } from "./ui";
import type { RelatedCompany, RelatedResult } from "./read";
import type { PublicJobItem } from "../types";
const identity = vi.hoisted(() => ({ role: "candidate" }));
vi.mock("@/features/identity/identity-session", () => ({ useIdentity: () => ({ status: "authenticated", result: { ok: true, data: { role: identity.role } } }) }));
afterEach(() => { cleanup(); identity.role = "candidate"; });
const company: RelatedCompany = { ...vacancyDetail.company, description: null, careersHref: null, sector: null, size: null };
const jobs = Array.from({ length: 4 }, (_, i) => listItem({ ...vacancyDetail, id: `other-${i}`, title: `Vacante ${i}` }));
const ok = <T,>(data: T): RelatedResult<T> => ({ ok: true, data });
const slots = (node: Element) => Array.from(node.querySelectorAll('[data-slot^="card"]')).map(el => el.getAttribute("data-slot"));

describe("detail exploration", () => {
  it.each([null, "Creamos herramientas para pequeños negocios."])("renders company identity and rows with description %s", description => {
    const { container } = render(<CompanySection company={ok({ ...company, description })} vacancies={ok(jobs)} />);
    const region = screen.getByRole("region", { name: "Sobre Acme" });
    expect(within(region).getByRole("heading", { level: 2 })).toHaveTextContent("Sobre Acme");
    expect(within(region).getAllByRole("link")).toHaveLength(3);
    expect(within(region).getByRole("link", { name: /Vacante 0/ })).toHaveAttribute("href", "/vacantes/other-0");
    within(region).getAllByRole("link").forEach(link => {
      expect(link.querySelector('[data-slot="avatar"]')).not.toBeNull();
    });
    expect(region).toHaveTextContent("Ciudad de México · Híbrido");
    expect(region).toHaveTextContent("$30,000 – $40,000 MXN");
    expect(region).toHaveTextContent("Mensual · Bruto");
    expect(container.querySelectorAll('a a, a button')).toHaveLength(0);
    expect(screen.queryByText("Conoce la empresa")).toBeNull();
    if (description) expect(screen.getByText(description)).toBeVisible();
    else expect(container).not.toHaveTextContent(/Sin descripción|No disponible/);
  });
  it("links to a careers site only when published and keeps a profile without rows", () => {
    render(<CompanySection company={ok({ ...company, careersHref: "/empresas/acme" })} vacancies={ok([])} />);
    expect(screen.getByRole("link", { name: /Conoce la empresa/ })).toHaveAttribute("href", "/empresas/acme");
  });
  it.each([ok([]), { ok: false } as const])("omits a company with neither profile nor other vacancies", vacancies => {
    const { container } = render(<CompanySection company={ok(company)} vacancies={vacancies} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("omits a failed company profile without hiding similar vacancies", () => {
    render(<><CompanySection company={{ ok: false }} vacancies={ok(jobs)} /><SimilarSection result={ok(jobs)} /></>);
    expect(screen.queryByRole("region", { name: "Sobre Acme" })).toBeNull();
    expect(screen.getByRole("region", { name: "Vacantes similares" })).toBeVisible();
  });
  it("keeps a published description when company vacancies fail", () => {
    render(<CompanySection company={ok({ ...company, description: "Somos Acme." })} vacancies={{ ok: false }} />);
    expect(screen.getByText("Somos Acme.")).toBeVisible();
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("caps similar cards at three, each one complete link with visible focus", () => {
    const { container } = render(<SimilarSection result={ok(jobs)} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    links.forEach((link, index) => {
      expect(link).toHaveAttribute("href", `/vacantes/other-${index}`);
      expect(link.className).toMatch(/focus-visible/);
      expect(link).toHaveTextContent(/Acme.*Ciudad de México · Híbrido.*MXN/);
      expect(within(link).getByRole("heading", { level: 3 })).toHaveClass("line-clamp-2");
    });
    expect(container.querySelectorAll('a a, a button')).toHaveLength(0);
  });
  it.each([ok([]), { ok: false } as const])("omits empty or failed similar results", result => {
    const { container } = render(<SimilarSection result={result} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("renders canonical search links and omits absent filters", () => {
    const { rerender, container } = render(<RelatedSearches job={vacancyDetail} />);
    expect(screen.getByRole("region", { name: "Sigue buscando" })).toBeVisible();
    screen.getAllByRole("link").forEach(link => {
      expect(link).toHaveClass("border-border");
      expect(link).not.toHaveClass("border-transparent");
    });
    expect(screen.getAllByRole("link").map(link => link.getAttribute("href"))).toEqual([
      "/vacantes?state=09&professional_area=technology_systems", "/vacantes?state=09",
    ]);
    rerender(<RelatedSearches job={legacyDetail} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("keeps the detail and independent sections while reads are pending", async () => {
    let resolveCompany!: (result: RelatedResult<RelatedCompany>) => void;
    let resolveVacancies!: (result: RelatedResult<PublicJobItem[]>) => void;
    const companyRead = new Promise<RelatedResult<RelatedCompany>>(resolve => { resolveCompany = resolve; });
    const companyVacancies = new Promise<RelatedResult<PublicJobItem[]>>(resolve => { resolveVacancies = resolve; });
    await act(async () => { render(<ExploreDetail job={vacancyDetail} company={companyRead} companyVacancies={companyVacancies} similar={Promise.resolve(ok(jobs))} />); });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(vacancyDetail.title);
    expect(screen.getByText("Cargando empresa y sus vacantes").parentElement).toHaveAttribute("aria-busy", "true");
    await act(async () => {});
    expect(await screen.findByRole("heading", { name: "Vacantes similares" })).toBeVisible();
    await act(async () => { resolveCompany(ok(company)); resolveVacancies(ok(jobs)); });
    const region = await screen.findByRole("region", { name: "Sobre Acme" });
    const grid = region.closest('[data-slot="public-job-detail"]')!.lastElementChild!;
    expect(grid.children[0]).toContainElement(region);
    expect(grid.children[1]).toHaveAttribute("aria-label", "Compensación y postulación");
    expect(screen.queryByText("Cargando empresa y sus vacantes")).toBeNull();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const similar = screen.getByRole("region", { name: "Vacantes similares" });
    expect(grid.closest("article")!.contains(similar)).toBe(false);
    expect(similar.compareDocumentPosition(screen.getByRole("region", { name: "Sigue buscando" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("matches skeleton Card slots to final company and similar content", () => {
    const { container, rerender } = render(<><CompanySkeleton /><SimilarSkeleton /></>);
    const pending = slots(container);
    expect(container.querySelectorAll('[data-slot="skeleton"][aria-hidden="true"]').length).toBeGreaterThan(0);
    rerender(<><CompanySection company={ok({ ...company, description: "Somos Acme." })} vacancies={ok(jobs)} /><SimilarSection result={ok(jobs)} /></>);
    expect(slots(container)).toEqual(pending);
  });
  it("shows a shaped similar skeleton while its promise is pending", async () => {
    await act(async () => {
      render(<ExploreDetail job={vacancyDetail} company={Promise.resolve(ok(company))} companyVacancies={Promise.resolve(ok([]))} similar={new Promise(() => {})} />);
    });
    const skeleton = screen.getByText("Cargando vacantes similares").parentElement!;
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(within(skeleton).queryByRole("link")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(vacancyDetail.title);
  });
  it("reuses the aside apply href in the mobile-only bar and reserves bottom space", () => {
    render(<MobileApplyBar job={vacancyDetail} />);
    const bar = screen.getByRole("region", { name: "Postulación móvil" });
    expect(bar).toHaveClass("fixed", "bottom-0", "lg:hidden");
    expect(within(bar).getByRole("link", { name: "Postularme" })).toHaveAttribute("href", `/vacantes/${vacancyDetail.id}/postular`);
    expect(bar.parentElement).toHaveClass("pb-32", "lg:pb-0");
    expect(bar).toHaveTextContent("$30,000 – $40,000 MXN");
    expect(bar).toHaveTextContent("Mensual · Bruto");
  });
  it("omits mobile salary when the public projection has no compensation (absent or hidden)", () => {
    render(<MobileApplyBar job={{ ...vacancyDetail, compensation: null }} />);
    const bar = screen.getByRole("region", { name: "Postulación móvil" });
    expect(bar).not.toHaveTextContent(/MXN|Salario no publicado|30,000/);
    expect(within(bar).getByRole("link", { name: "Postularme" })).toHaveAttribute("href", `/vacantes/${vacancyDetail.id}/postular`);
  });
  it("shows the company session note instead of an apply link", () => {
    identity.role = "recruiter";
    render(<MobileApplyBar job={vacancyDetail} />);
    expect(screen.getByText("Las postulaciones son para cuentas de candidato")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Postularme" })).toBeNull();
  });
  it("has no mobile bar for legacy rows or preview", () => {
    const { container, rerender } = render(<MobileApplyBar job={legacyDetail} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<PublicJobDetailView job={vacancyDetail} preview />);
    expect(screen.queryByRole("region", { name: "Postulación móvil" })).toBeNull();
  });
});

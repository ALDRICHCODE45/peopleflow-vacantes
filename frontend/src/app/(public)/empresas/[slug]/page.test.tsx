import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import Page, { generateMetadata, dynamic, runtime } from "@/app/(public)/empresas/[slug]/page";
import { CompanySitePage } from "@/features/company-site/public/company-site-page";
import NotFound from "@/app/(public)/empresas/[slug]/not-found";
import ErrorBoundary from "@/app/(public)/empresas/[slug]/error";
import { publishedFixture, mediaId } from "@/features/company-site/public/fixtures.test-support";
vi.mock("next/font/google", () => ({ Fraunces: () => ({ variable: "__variable_fraunces" }), Plus_Jakarta_Sans: () => ({ variable: "__variable_jakarta" }) }));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 8000, siteUrl: "https://peopleflow.example" } }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, permanentRedirect: (href: string) => { throw new Error(`NEXT_REDIRECT_308:${href}`); } }));
const props = (slug = "nexo-labs") => ({ params: Promise.resolve({ slug }) });
const respond = (body: unknown, status = 200) => vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify(url.includes("/v2/jobs?") ? { items: [], next_cursor: null } : body), { status }))));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("is dynamic Node and renders the real published site", async () => {
  respond(publishedFixture());
  const page = await Page(props());
  // RTL is not an RSC runtime: resolve the nested server component explicitly.
  render(await CompanySitePage(page.props));
  expect(dynamic).toBe("force-dynamic"); expect(runtime).toBe("nodejs"); expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Trabaja con Nexo");
});
it("404 for invalid, unknown and unpublished sites", async () => {
  respond({}); await expect(Page(props("bad/path"))).rejects.toThrow("NEXT_NOT_FOUND"); expect(fetch).not.toHaveBeenCalled();
  respond({ code: "site_not_found", error: "Missing" }, 404); await expect(Page(props())).rejects.toThrow("NEXT_NOT_FOUND");
});
it("redirects old slugs permanently before loading jobs", async () => {
  respond(publishedFixture()); await expect(Page(props("old-nexo"))).rejects.toThrow("NEXT_REDIRECT_308:/empresas/nexo-labs"); expect(fetch).toHaveBeenCalledTimes(1);
});
it.each([{}, { ...publishedFixture(), site: {} }])("throws on invalid projection rather than rendering a prototype or 404", async data => {
  respond(data); await expect(Page(props())).rejects.toThrow("No se pudo cargar el sitio");
});
it("does not mask jobs failure as an empty list", async () => {
  const data = publishedFixture(); respond(data);
  vi.mocked(fetch).mockImplementation(async url => new Response(JSON.stringify(String(url).includes("/jobs?") ? {} : data)));
  await expect(Page(props())).rejects.toThrow("No se pudieron cargar las vacantes");
});
it("metadata uses profile fallbacks, current canonical and a same-origin hero cover", async () => {
  respond(publishedFixture());
  expect(await generateMetadata(props())).toMatchObject({ title: "Nexo · Empleos", description: "Un equipo real", alternates: { canonical: "https://peopleflow.example/empresas/nexo-labs" }, robots: { index: true, follow: true }, openGraph: { images: [{ url: `https://peopleflow.example/media/sitios/${mediaId}` }] } });
});
it("metadata honors SEO overrides and omits a missing cover", async () => {
  const data = publishedFixture(); data.site.seo = { title: "Oportunidades en Nexo", description: "Tu próximo paso" };
  const hero = data.site.blocks.find(block => block.type === "hero")!; if (hero.type === "hero") hero.content.cover = null;
  respond(data); const metadata = await generateMetadata(props()); expect(metadata.title).toBe(data.site.seo.title); expect(metadata.description).toBe(data.site.seo.description); expect(metadata.openGraph?.images).toBeUndefined();
});
it("metadata 404s, redirects or throws consistently with the page", async () => {
  respond({ code: "site_not_found" }, 404); await expect(generateMetadata(props())).rejects.toThrow("NEXT_NOT_FOUND");
  respond(publishedFixture()); await expect(generateMetadata(props("old-nexo"))).rejects.toThrow("NEXT_REDIRECT_308:/empresas/nexo-labs");
  respond({}, 503); await expect(generateMetadata(props())).rejects.toThrow("No se pudo cargar el sitio");
});
it.each([
  { state: "not-found", title: "Este sitio no está disponible" },
  { state: "error", title: "No se pudo cargar el sitio" },
])("$state owns one main, a level-one StateCard heading and a PeopleFlow home link", ({ state, title }) => {
  const reset = vi.fn();
  render(state === "not-found" ? <NotFound /> : <ErrorBoundary error={new Error("private")} reset={reset} />);
  const main = screen.getByRole("main");
  expect(screen.getAllByRole("main")).toHaveLength(1);
  const heading = within(main).getByRole("heading", { level: 1, name: title });
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(heading.closest('[data-slot="empty"]')).not.toBeNull();
  const brand = within(main).getByRole("link", { name: "PeopleFlow" });
  expect(brand).toHaveAttribute("href", "/");
  expect(brand.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(main).getByRole("link", { name: "Explorar vacantes" })).toHaveAttribute("href", "/vacantes");
  expect(document.querySelector("[data-pf-public-navbar]")).toBeNull();
  expect(document.querySelector("[data-slot=sidebar-wrapper]")).toBeNull();
  if (state === "error") {
    fireEvent.click(within(main).getByRole("button", { name: "Reintentar" }));
    expect(reset).toHaveBeenCalledTimes(1);
  }
});
it("not-found and error boundaries use StateCard with an escape path", () => {
  const view = render(<NotFound />); expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Este sitio no está disponible"); expect(screen.getByRole("link", { name: "Explorar vacantes" })).toHaveAttribute("href", "/vacantes"); expect(view.container.querySelector('[data-slot="empty"]')).not.toBeNull();
  view.unmount(); render(<ErrorBoundary error={new Error("private")} reset={vi.fn()} />); expect(screen.getByRole("alert")).toBeVisible(); expect(screen.getByRole("button", { name: "Reintentar" })).toBeVisible(); expect(screen.queryByText("private")).toBeNull();
});

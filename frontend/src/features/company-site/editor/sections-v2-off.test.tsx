import "./browser-platform.test-support";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
vi.mock("next/font/google", () => ({ Fraunces: () => ({ variable: "editorial" }), Plus_Jakarta_Sans: () => ({ variable: "modern" }) }));
vi.mock("../api/actions", () => ({ saveDraftAction: vi.fn(), slugAvailabilityAction: vi.fn().mockResolvedValue({ kind: "uncertain" }), publishSiteAction: vi.fn(), unpublishSiteAction: vi.fn() }));
vi.mock("@/components/ui/dropdown-menu", async original => {
  const parts = await original<typeof import("@/components/ui/dropdown-menu")>();
  return { ...parts, DropdownMenuContent: ({ children }: { children: ReactNode }) => <parts.DropdownMenuGroup>{children}</parts.DropdownMenuGroup> };
});
vi.mock("./media", () => ({ ImageField: ({ label }: { label: string }) => <p>{label}</p> }));
import { CareersSiteEditor } from "./index";
import { publishedFixture } from "../public/fixtures.test-support";
import { defaultBlockV2 } from "../defaults";
import type { SiteState } from "../api/model";
import { SECTIONS_V2_ENABLED } from "../sections-v2";
import { v2Draft } from "./site-state.test-support";
import { offeredVariants } from "./variant-picker";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount() {
  const data = publishedFixture();
  const draft = v2Draft({ ...data.site, slug: data.slug }); draft.blocks.splice(1, 0, defaultBlockV2("testimonials"));
  const initialSite: SiteState = { draft, draft_version: 7, published: null, has_unpublished_changes: false, media: data.media, updated_at: data.published_at };
  render(<CareersSiteEditor initialSite={initialSite} role="owner" preview={{ company: data.company, jobs: [], officeLabels: new Map() }} />);
  await screen.findByRole("heading", { name: "Tu página" });
}
const properties = () => screen.getByRole("complementary", { name: "Propiedades de la sección" });

it("is off when NEXT_PUBLIC_CAREERS_SECTIONS_V2 is \"false\" (the kill switch these tests run with)", () => {
  expect(process.env.NEXT_PUBLIC_CAREERS_SECTIONS_V2).toBe("false");
  expect(SECTIONS_V2_ENABLED).toBe(false);
});
it("is on by default and with any other value; only \"false\" turns it off", async () => {
  for (const [value, expected] of [[undefined, true], ["true", true], ["", true], ["false", false]] as const) {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_CAREERS_SECTIONS_V2", value as string);
    const flags = await import("../sections-v2");
    expect(flags.SECTIONS_V2_ENABLED, String(value)).toBe(expected);
    vi.unstubAllEnvs();
  }
});
it("keeps today's properties: no groups, no «Estilo de sección», no button texts, today's layouts", async () => {
  await mount();
  expect(properties().querySelector("[data-property-groups]")).toBeNull();
  expect(within(properties()).queryByText("Estilo de sección")).toBeNull();
  expect(within(properties()).queryByText("Botón principal")).toBeNull();
  expect(within(properties()).getByText(/«Conoce la empresa» aparece si hay una Historia visible/)).toBeInTheDocument();
  const layouts = within(properties()).getByRole("group", { name: "Diseño de sección" });
  expect(within(layouts).getAllByRole("button").map(node => node.getAttribute("aria-label"))).toEqual(["Diseño Fotográfica", "Diseño Dividida", "Diseño Centrada"]);
  expect(within(layouts).queryByText("Nuevo")).toBeNull();
});
it("keeps today's testimonial fields and the text library dialog", async () => {
  await mount();
  fireEvent.click(within(screen.getByRole("list", { name: "Secciones del sitio" })).getByRole("button", { name: "Seleccionar Testimonios" }));
  fireEvent.click(within(properties()).getByRole("button", { name: "Agregar testimonio" }));
  expect(within(properties()).queryByLabelText("Video del testimonio")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Agregar sección" }));
  const library = await screen.findByRole("dialog", { name: "Agregar sección" });
  expect(within(library).getAllByRole("button", { name: /^Agregar / })).toHaveLength(13);
  expect(within(library).queryByText("Equipo / Líderes")).toBeNull();
  expect(screen.queryByRole("region", { name: "Agregar sección" })).toBeNull();
});
it("never offers «Fondo en movimiento» (background video) with the flag off", () => {
  expect(offeredVariants("hero")).toEqual(["photo", "split", "centered"]);
});

import "./browser-platform.test-support";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { CareersSiteEditor, CareersSiteEditorLoading, CareersSiteEditorError } from "./index";
import { publishedFixture } from "../public/fixtures.test-support";
import { defaultBlock } from "../defaults";
import type { SiteState, SiteResult } from "../api/model";
import { saveDraftAction } from "../api/actions";
import { RECRUITER_PUBLISH_REASON } from "../permissions";
vi.mock("next/font/google", () => ({ Fraunces: () => ({ variable: "editorial" }), Plus_Jakarta_Sans: () => ({ variable: "modern" }) }));
vi.mock("../api/actions", () => ({ saveDraftAction: vi.fn() }));
// Base UI menu portals cannot be positioned by jsdom; keep its actual controller,
// focus and items, bypass only portal/positioning (browser review still required).
vi.mock("@/components/ui/dropdown-menu", async original => {
  const parts = await original<typeof import("@/components/ui/dropdown-menu")>();
  return { ...parts, DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <parts.DropdownMenuGroup>{children}</parts.DropdownMenuGroup> };
});
function fixture() {
  const data = publishedFixture();
  const initialSite: SiteState = { draft: { ...data.site, slug: data.slug }, draft_version: 7, published: null, has_unpublished_changes: false, media: data.media, updated_at: data.published_at };
  return { initialSite, role: "owner", preview: { company: data.company, jobs: [], officeLabels: new Map<string, string>() } };
}
async function mount(role = "owner") {
  const props = fixture(); render(<CareersSiteEditor {...props} role={role} />);
  await screen.findByRole("heading", { name: "Tu página" });
  return props;
}
function list() { return screen.getByRole("list", { name: "Secciones del sitio" }); }
function frame() { return within((screen.getByTitle("Vista previa del sitio") as HTMLIFrameElement).contentDocument!.body); }
function row(name: string) { return within(list()).getByRole("button", { name: `Seleccionar ${name}` }).closest('[role="listitem"]') as HTMLElement; }
beforeEach(() => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.mocked(saveDraftAction).mockImplementation(async ({ body }) => ({ kind: "success", data: { ...fixture().initialSite, draft: body as SiteState["draft"], draft_version: 8 }, etag: '"8"' }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it("adds from the thirteen-type library, with protected types disabled and explained", async () => {
  await mount(); const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Agregar sección" }));
  const library = await screen.findByRole("dialog", { name: "Agregar sección" });
  expect(within(library).getAllByRole("button", { name: /^Agregar / })).toHaveLength(13);
  expect(within(library).getByRole("button", { name: "Agregar Portada" })).toBeDisabled();
  expect(within(library).getByRole("button", { name: "Agregar Vacantes abiertas" })).toBeDisabled();
  expect(within(library).getAllByText("Ya está en tu sitio; solo puede haber una.")).toHaveLength(2);
  await user.click(within(library).getByRole("button", { name: "Agregar Historia" }));
  expect(row("Historia")).toHaveTextContent("Incompleta");
  expect(screen.getByRole("heading", { name: "Propiedades de Historia" })).toBeVisible();
  expect(frame().getByText("Agrega contenido a esta sección para verla en tu sitio.")).toBeInTheDocument();
});
it("reorders with keyboard actions, hides/shows, duplicates and confirms deletion", async () => {
  const props = fixture(); props.initialSite.draft.blocks.splice(1, 0, defaultBlock("story"));
  render(<CareersSiteEditor {...props} />); await screen.findByRole("heading", { name: "Tu página" });
  const user = userEvent.setup();
  const up = within(row("Historia")).getByRole("menuitem", { name: "Subir" }); up.focus(); await user.keyboard("{Enter}");
  expect(within(list()).getAllByRole("listitem")[0]).toHaveTextContent("Historia");
  const down = within(row("Historia")).getByRole("menuitem", { name: "Bajar" }); down.focus(); await user.keyboard("{Enter}");
  expect(within(list()).getAllByRole("listitem")[0]).toHaveTextContent("Portada");
  await user.click(within(row("Historia")).getByRole("switch", { name: "Mostrar Historia" }));
  expect(row("Historia")).toHaveTextContent("Oculta");
  expect(frame().queryByRole("heading", { name: "Historia" })).toBeNull();
  await user.click(within(row("Historia")).getByRole("switch", { name: "Mostrar Historia" }));
  await user.click(within(row("Historia")).getByRole("menuitem", { name: "Duplicar" }));
  expect(within(list()).getAllByRole("button", { name: "Seleccionar Historia" })).toHaveLength(2);
  const rows = within(list()).getAllByRole("listitem");
  await user.click(within(rows[1]).getByRole("menuitem", { name: "Eliminar" }));
  const confirm = await screen.findByRole("alertdialog");
  expect(within(confirm).getByRole("button", { name: "Cancelar" })).toHaveFocus();
  expect(within(rows[1].parentElement!).getAllByRole("button", { name: "Seleccionar Historia", hidden: true })).toHaveLength(2);
  await user.click(within(confirm).getByRole("button", { name: "Cancelar" }));
  await user.click(within(rows[1]).getByRole("menuitem", { name: "Eliminar" }));
  await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Eliminar sección" }));
  expect(within(list()).getAllByRole("button", { name: "Seleccionar Historia" })).toHaveLength(1);
});
it("protects hero and jobs without forbidding their model-supported reordering", async () => {
  await mount();
  for (const label of ["Portada", "Vacantes abiertas"]) {
    expect(within(row(label)).getByRole("switch")).toBeDisabled();
    expect(within(row(label)).getByRole("menuitem", { name: "Duplicar" })).toHaveAttribute("aria-disabled", "true");
    expect(within(row(label)).getByRole("menuitem", { name: "Eliminar" })).toHaveAttribute("aria-disabled", "true");
  }
  expect(within(row("Portada")).getByRole("menuitem", { name: "Subir" })).toHaveAttribute("aria-disabled", "true");
  expect(within(row("Vacantes abiertas")).getByRole("menuitem", { name: "Bajar" })).toHaveAttribute("aria-disabled", "true");
  expect(row("Vacantes abiertas")).not.toHaveTextContent("Incompleta");
});
it("selects from list and preview, changes real variant markers and device width", async () => {
  await mount(); const user = userEvent.setup();
  await user.click(within(list()).getByRole("button", { name: "Seleccionar Portada" }));
  expect(screen.getByRole("heading", { name: "Propiedades de Portada" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Diseño Centrada" }));
  expect(frame().getByRole("heading", { level: 1 }).closest("section")).toHaveAttribute("data-variant", "centered");
  await user.click(frame().getByRole("heading", { name: "Vacantes abiertas" }));
  expect(screen.getByRole("heading", { name: "Propiedades de Vacantes abiertas" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Móvil" }));
  expect(screen.getByTitle("Vista previa del sitio").closest("[data-device]")).toHaveAttribute("data-device", "mobile");
  await user.click(screen.getByRole("button", { name: "Tableta" }));
  expect(screen.getByTitle("Vista previa del sitio").closest("[data-device]")).toHaveAttribute("data-device", "tablet");
});
it("keeps recruiter draft editing available, publish disabled, placeholders honest and visitor mode free of affordances", async () => {
  await mount("recruiter"); const user = userEvent.setup();
  expect(screen.getByText(RECRUITER_PUBLISH_REASON)).toBeVisible();
  expect(screen.getByRole("button", { name: "Publicar" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Agregar sección" })).toBeEnabled();
  await user.click(screen.getByRole("tab", { name: "Marca" })); expect(screen.getByText("La edición de marca estará disponible pronto.")).toBeVisible();
  await user.click(screen.getByRole("tab", { name: "Configuración" })); expect(screen.getByText("La configuración del sitio estará disponible pronto.")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Ver como visitante" }));
  const visitor = await screen.findByRole("dialog", { name: "Vista previa pública" });
  const visitorFrame = within(visitor).getByTitle("Vista del visitante") as HTMLIFrameElement;
  await waitFor(() => expect(visitorFrame.contentDocument!.querySelector("h1")).not.toBeNull());
  expect(visitorFrame.contentDocument!.querySelector("[data-editor-selected]")).toBeNull();
  await user.click(within(visitor).getByRole("button", { name: "Volver al editor" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Ver como visitante" })).toHaveFocus());
});
it.each([
  ["uncertain", "Sin conexión — reintentaremos"],
  ["invalid", "Revisa los campos marcados"],
  ["error", "No se pudieron guardar los cambios"],
  ["conflict", "Otra persona editó el sitio"],
  ["success", "Cambios guardados"],
] as const)("announces real autosave %s state and preserves the draft on conflict", async (kind, label) => {
  let complete!: (result: SiteResult) => void;
  vi.mocked(saveDraftAction).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const props = await mount();
  expect(screen.getByRole("status", { name: "Estado del guardado" })).toHaveTextContent("Sin cambios pendientes");
  fireEvent.click(within(list()).getByRole("button", { name: "Seleccionar Portada" }));
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Diseño Centrada" }));
  await act(async () => { vi.advanceTimersByTime(1500); });
  const status = screen.getByRole("status", { name: "Estado del guardado" });
  expect(status).toHaveAttribute("aria-live", "polite"); expect(status).toHaveTextContent("Guardando…");
  expect(saveDraftAction).toHaveBeenCalledWith(expect.objectContaining({ ifMatch: '"7"' }));
  const current = { ...props.initialSite, draft_version: 9 };
  const result: SiteResult = kind === "success" ? { kind, data: current, etag: '"9"' } : kind === "conflict" ? { kind, current } : kind === "invalid" ? { kind, fields: [{ field: "blocks[0].content.title", code: "required" }] } : kind === "error" ? { kind, code: "forbidden" } : { kind };
  await act(async () => complete(result)); expect(status).toHaveTextContent(label);
  if (kind === "conflict") {
    fireEvent.click(screen.getByRole("button", { name: "Cargar la versión más reciente" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cargar versión" }));
    expect(status).toHaveTextContent("Sin cambios pendientes");
    expect(frame().getByRole("heading", { level: 1 }).closest("section")).toHaveAttribute("data-variant", "photo");
  }
});
it("mirrors editor regions when loading, and retries an error only on demand", async () => {
  const { container, unmount } = render(<CareersSiteEditorLoading />);
  expect(screen.getByRole("status")).toHaveTextContent("Cargando editor");
  expect(container.querySelectorAll("[data-editor-region]")).toHaveLength(4);
  expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(15);
  unmount(); const retry = vi.fn(); render(<CareersSiteEditorError onRetry={retry} />);
  expect(retry).not.toHaveBeenCalled(); await userEvent.click(screen.getByRole("button", { name: "Reintentar" })); expect(retry).toHaveBeenCalledOnce();
});

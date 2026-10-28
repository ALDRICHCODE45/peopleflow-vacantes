import "./browser-platform.test-support";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { CareersSiteEditor } from "./careers-site-editor";
import { defaultBlock, defaultSiteDraft } from "../defaults";
import type { SiteState } from "../api/model";
import { publishedFixture } from "../public/fixtures.test-support";
import { publishSiteAction, saveDraftAction, unpublishSiteAction, slugAvailabilityAction } from "../api/actions";
import { notifyActionResult } from "@/components/feedback/notify";
vi.mock("next/font/google", () => ({ Fraunces: () => ({ variable: "editorial" }), Plus_Jakarta_Sans: () => ({ variable: "modern" }) }));
vi.mock("../api/actions", () => ({ saveDraftAction: vi.fn(), publishSiteAction: vi.fn(), unpublishSiteAction: vi.fn(), slugAvailabilityAction: vi.fn().mockResolvedValue({ kind: "uncertain" }) }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
vi.mock("./media", () => ({ ImageField: () => null }));
vi.mock("@/components/ui/dropdown-menu", async original => {
  const parts = await original<typeof import("@/components/ui/dropdown-menu")>();
  return { ...parts, DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <parts.DropdownMenuGroup>{children}</parts.DropdownMenuGroup> };
});
function props() {
  const draft = defaultSiteDraft(); draft.slug = "nexo";
  const hero = draft.blocks[0]; if (hero.type === "hero") hero.content.title = "Únete";
  const closing = defaultBlock("closing"); if (closing.type === "closing") closing.content.title = "Crece";
  draft.blocks.push(closing);
  const initialSite: SiteState = { draft, draft_version: 7, published: null, has_unpublished_changes: false, media: [], updated_at: "2026-10-27T00:00:00Z" };
  const company = { ...publishedFixture().company, logo_url: "https://example.com/logo.png", description: "Perfil conectado", website: "https://example.com", linkedin_url: "https://linkedin.com/company/nexo" };
  return { initialSite, role: "owner", preview: { company, jobs: [], officeLabels: new Map<string, string>() } };
}
function frame() { return (screen.getByTitle("Vista previa del sitio") as HTMLIFrameElement).contentDocument!; }
beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.mocked(slugAvailabilityAction).mockResolvedValue({ kind: "uncertain" });
  vi.mocked(saveDraftAction).mockImplementation(async ({ body }) => ({ kind: "success", data: { ...props().initialSite, draft: body as SiteState["draft"], draft_version: 8 }, etag: '"8"' }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
it("keeps the editor available alongside a non-blocking profile notice", async () => {
  render(<CareersSiteEditor {...props()} notice="No pudimos cargar el perfil de la empresa. Puedes seguir editando." />);
  expect(await screen.findByText("No pudimos cargar el perfil de la empresa. Puedes seguir editando.")).toBeVisible();
  expect(screen.getByLabelText("Título principal")).toBeEnabled();
  expect(screen.getByTitle("Vista previa del sitio")).toBeInTheDocument();
});
it("allows publication recovery with an unavailable profile and uses the server identity checklist", async () => {
  const p = props();
  vi.mocked(publishSiteAction).mockResolvedValue({ kind: "error", code: "publish_blocked", issues: [{ code: "company_logo_missing", field: null }] });
  render(<CareersSiteEditor {...p} preview={{ ...p.preview, company: { ...p.preview.company, name: "", logo_url: null } }} notice="No pudimos cargar el perfil de la empresa. Puedes seguir editando." />);
  await screen.findByRole("button", { name: "Publicar" });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Publicar" })));
  expect(screen.getByRole("alertdialog")).toHaveTextContent("¿Publicar tu sitio?");
  await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Publicar sitio" })));
  expect(screen.getByRole("dialog", { name: "Antes de publicar" })).toHaveTextContent("Agrega el logo de la empresa");
});
it("updates the real preview font attribute immediately", async () => {
  render(<CareersSiteEditor {...props()} />);
  await screen.findByRole("tab", { name: "Marca" }); fireEvent.click(screen.getByRole("tab", { name: "Marca" }));
  fireEvent.click(screen.getByRole("button", { name: "Editorial" }));
  expect(frame().querySelector("[data-font-pair]")).toHaveAttribute("data-font-pair", "editorial");
});
it("updates the preview with the adjusted brand color immediately", async () => {
  render(<CareersSiteEditor {...props()} />);
  await screen.findByRole("tab", { name: "Marca" }); fireEvent.click(screen.getByRole("tab", { name: "Marca" }));
  fireEvent.change(screen.getByLabelText("Principal"), { target: { value: "#FFFF00" } });
  expect(frame().querySelector<HTMLElement>("[data-font-pair]")!.style.getPropertyValue("--site-brand-light")).not.toBe("#FFFF00");
});
it("uses profile identity in both the real preview and settings summary", async () => {
  render(<CareersSiteEditor {...props()} />); await screen.findByRole("tab", { name: "Ajustes" });
  expect(within(frame().body).getByText("Perfil conectado")).toBeInTheDocument();
  for (const link of within(frame().body).getAllByRole("link", { name: "LinkedIn" })) expect(link).toHaveAttribute("href", "https://linkedin.com/company/nexo");
  fireEvent.click(screen.getByRole("tab", { name: "Ajustes" }));
  expect(within(screen.getByRole("region", { name: "Datos de la empresa" })).getByText("Perfil conectado")).toBeVisible();
  expect(screen.getByRole("tabpanel", { name: "Ajustes" })).toHaveClass("px-1", "py-1", "pr-3");
});
it("updates header to published on success and amber on the next edit", async () => {
  const p = props(); render(<CareersSiteEditor {...p} />); await screen.findByText("Sin publicar");
  vi.mocked(publishSiteAction).mockResolvedValue({ kind: "success", data: { ...p.initialSite, published: { version: 7, slug: "nexo", published_at: p.initialSite.updated_at } }, etag: '"7"' });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Publicar" })));
  await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Publicar sitio" })));
  expect(screen.getByText("Publicado")).toHaveAttribute("data-variant", "success");
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  fireEvent.change(screen.getByLabelText("Título principal"), { target: { value: "Otro título" } });
  expect(screen.getByText("Cambios sin publicar")).toHaveAttribute("data-variant", "review");
});
it("keeps a taken slug out of the header and PUT while unrelated SEO changes still save", async () => {
  render(<CareersSiteEditor {...props()} />); await screen.findByText("Sin publicar");
  fireEvent.click(screen.getByRole("tab", { name: "Ajustes" })); vi.useFakeTimers();
  vi.mocked(slugAvailabilityAction).mockResolvedValue({ kind: "success", data: { slug: "otra-empresa", available: false, reason: "taken" } });
  fireEvent.change(screen.getByLabelText("Dirección pública"), { target: { value: "otra-empresa" } });
  expect(screen.queryByRole("link", { name: "/empresas/otra-empresa" })).not.toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(1850)); expect(saveDraftAction).not.toHaveBeenCalled();
  expect(screen.getByRole("status", { name: "Disponibilidad de dirección" })).toHaveTextContent("En uso");
  fireEvent.change(screen.getByLabelText("Título SEO"), { target: { value: "Equipo real" } });
  await act(() => vi.advanceTimersByTimeAsync(1500));
  expect(saveDraftAction).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ body: expect.objectContaining({ slug: "nexo", seo: expect.objectContaining({ title: "Equipo real" }) }) }));
  expect(screen.getByRole("link", { name: "/empresas/nexo" })).toBeVisible();
});
it("dispatches and saves an available slug, updating the actual header URL", async () => {
  render(<CareersSiteEditor {...props()} />); await screen.findByText("Sin publicar");
  fireEvent.click(screen.getByRole("tab", { name: "Ajustes" })); vi.useFakeTimers();
  vi.mocked(slugAvailabilityAction).mockResolvedValue({ kind: "success", data: { slug: "otra-empresa", available: true, reason: null } });
  fireEvent.change(screen.getByLabelText("Dirección pública"), { target: { value: "otra-empresa" } });
  expect(saveDraftAction).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1850));
  expect(saveDraftAction).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ body: expect.objectContaining({ slug: "otra-empresa" }) }));
  expect(screen.getByRole("link", { name: "/empresas/otra-empresa" })).toBeVisible();
});
it.each([["slug_taken", "Otra empresa ya usa esta dirección. Elige otra."], ["slug_reserved", "Esta dirección está reservada. Elige otra."]] as const)("marks Dirección pública when a previously available slug save returns %s", async (code, message) => {
  render(<CareersSiteEditor {...props()} />); await screen.findByText("Sin publicar");
  fireEvent.click(screen.getByRole("tab", { name: "Ajustes" })); vi.useFakeTimers();
  vi.mocked(slugAvailabilityAction).mockResolvedValue({ kind: "success", data: { slug: "otra-empresa", available: true, reason: null } });
  vi.mocked(saveDraftAction).mockResolvedValue({ kind: "error", code, field: "slug" });
  fireEvent.change(screen.getByLabelText("Dirección pública"), { target: { value: "otra-empresa" } });
  await act(() => vi.advanceTimersByTimeAsync(1850));
  expect(screen.getByRole("status", { name: "Estado del guardado" })).toHaveTextContent("Revisa los campos marcados");
  expect(screen.getByLabelText("Dirección pública")).toHaveAttribute("aria-invalid", "true"); expect(screen.getByText(message)).toBeVisible();
  expect(saveDraftAction).toHaveBeenCalledOnce();
});
it("unmounts during flush without publishing, notifying, or replaying the pending PUT", async () => {
  const p = props(); let resolve!: (value: Awaited<ReturnType<typeof saveDraftAction>>) => void;
  vi.mocked(saveDraftAction).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const { unmount } = render(<CareersSiteEditor {...p} />); await screen.findByText("Sin publicar");
  vi.useFakeTimers(); fireEvent.change(screen.getByLabelText("Título principal"), { target: { value: "Local pendiente" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Publicar" })));
  expect(saveDraftAction).toHaveBeenCalledOnce(); const submitted = vi.mocked(saveDraftAction).mock.calls[0][0].body as SiteState["draft"];
  unmount(); await act(async () => { await Promise.resolve(); });
  expect(notifyActionResult).not.toHaveBeenCalled(); expect(publishSiteAction).not.toHaveBeenCalled();
  await act(async () => resolve({ kind: "success", data: { ...p.initialSite, draft: submitted, draft_version: 8 }, etag: '"8"' }));
  await act(() => vi.advanceTimersByTimeAsync(5000));
  expect(saveDraftAction).toHaveBeenCalledOnce(); expect(publishSiteAction).not.toHaveBeenCalled(); expect(notifyActionResult).not.toHaveBeenCalled();
});
it("unmounts during publication without notifying or starting another request", async () => {
  const p = props(); let resolve!: (value: Awaited<ReturnType<typeof publishSiteAction>>) => void;
  vi.mocked(publishSiteAction).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const { unmount } = render(<CareersSiteEditor {...p} />); await screen.findByText("Sin publicar");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Publicar" })));
  await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Publicar sitio" })));
  expect(publishSiteAction).toHaveBeenCalledOnce(); unmount();
  await act(async () => resolve({ kind: "success", data: { ...p.initialSite, published: { version: 7, slug: "nexo", published_at: p.initialSite.updated_at } }, etag: '"7"' }));
  expect(notifyActionResult).not.toHaveBeenCalled(); expect(publishSiteAction).toHaveBeenCalledOnce(); expect(saveDraftAction).not.toHaveBeenCalled();
});
it("opens explicit reload confirmation after a publish version conflict", async () => {
  const p = props(); render(<CareersSiteEditor {...p} />); await screen.findByText("Sin publicar");
  const current = structuredClone(p.initialSite); current.draft_version = 9;
  const hero = current.draft.blocks[0]; if (hero.type === "hero") hero.content.title = "Versión del servidor";
  vi.mocked(publishSiteAction).mockResolvedValue({ kind: "conflict", current });
  vi.useFakeTimers(); fireEvent.change(screen.getByLabelText("Título principal"), { target: { value: "Cambio local" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Publicar" })));
  await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Publicar sitio" })));
  expect(screen.getByRole("alertdialog", { name: "¿Cargar la versión más reciente?" })).toBeInTheDocument();
  expect(screen.getByLabelText("Título principal")).toHaveValue("Cambio local");
  expect(publishSiteAction).toHaveBeenCalledExactlyOnceWith('"8"');
  await act(async () => fireEvent.click(within(screen.getByRole("alertdialog", { name: "¿Cargar la versión más reciente?" })).getByRole("button", { name: "Cargar versión" })));
  expect(screen.getByLabelText("Título principal")).toHaveValue("Versión del servidor");
  expect(within(frame().body).getByRole("heading", { level: 1 })).toHaveTextContent("Versión del servidor");
  await act(() => vi.advanceTimersByTimeAsync(5000));
  expect(saveDraftAction).toHaveBeenCalledOnce(); expect(publishSiteAction).toHaveBeenCalledOnce();
  expect(current.draft.blocks[0]).toMatchObject({ content: { title: "Versión del servidor" } });
});
it("reloads the newer autosave conflict rather than an older publish conflict and clears both", async () => {
  const p = props(); p.initialSite.draft_version = 4;
  const older = structuredClone(p.initialSite); older.draft_version = 5;
  const newer = structuredClone(p.initialSite); newer.draft_version = 6;
  if (older.draft.blocks[0].type === "hero") older.draft.blocks[0].content.title = "Servidor v5";
  if (newer.draft.blocks[0].type === "hero") newer.draft.blocks[0].content.title = "Servidor v6";
  vi.mocked(publishSiteAction).mockResolvedValue({ kind: "conflict", current: older });
  vi.mocked(saveDraftAction).mockResolvedValue({ kind: "conflict", current: newer });
  render(<CareersSiteEditor {...p} />); await screen.findByText("Sin publicar");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Publicar" })));
  await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Publicar sitio" })));
  fireEvent.click(within(screen.getByRole("alertdialog", { name: "¿Cargar la versión más reciente?" })).getByRole("button", { name: "Cancelar" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  vi.useFakeTimers();
  fireEvent.change(screen.getByLabelText("Título principal"), { target: { value: "Edición local" } });
  await act(() => vi.advanceTimersByTimeAsync(1500));
  expect(screen.getByRole("status", { name: "Estado del guardado" })).toHaveTextContent("Otra persona");
  fireEvent.click(screen.getByRole("button", { name: "Cargar la versión más reciente" }));
  await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cargar versión" })));
  fireEvent.click(screen.getByRole("button", { name: "Seleccionar Portada" }));
  expect(screen.getByLabelText("Título principal")).toHaveValue("Servidor v6");
  expect(within(frame().body).getByRole("heading", { level: 1 })).toHaveTextContent("Servidor v6");
  expect(screen.getByRole("status", { name: "Estado del guardado" })).not.toHaveTextContent("Otra persona");
  await act(() => vi.advanceTimersByTimeAsync(5000));
  expect(saveDraftAction).toHaveBeenCalledOnce();
});
it("returns the header to Sin publicar after confirmed unpublication", async () => {
  const p = props(); p.initialSite.published = { version: 7, slug: "nexo", published_at: p.initialSite.updated_at };
  render(<CareersSiteEditor {...p} />); await screen.findByText("Publicado");
  fireEvent.click(screen.getByRole("menuitem", { name: "Despublicar" }));
  vi.mocked(unpublishSiteAction).mockResolvedValue({ kind: "success", data: { ...p.initialSite, published: null }, etag: '"7"' });
  await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Despublicar sitio" })));
  expect(screen.getByText("Sin publicar")).toHaveAttribute("data-variant", "neutral");
});

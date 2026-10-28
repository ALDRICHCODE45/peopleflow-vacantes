import "./browser-platform.test-support";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { SitePublication } from "@/features/company-site/editor/publication";
import { createAutosave, type AutosaveController } from "../autosave";
import { defaultBlock, defaultSiteDraft } from "../defaults";
import type { SiteResult, SiteState } from "../api/model";
import { loadSiteAction, publishSiteAction, unpublishSiteAction } from "../api/actions";
import { notifyActionResult } from "@/components/feedback/notify";
import { TooltipProvider } from "@/components/ui/tooltip";
vi.mock("next/font/google", () => ({ Fraunces: () => ({ variable: "editorial" }), Plus_Jakarta_Sans: () => ({ variable: "modern" }) }));
vi.mock("../api/actions", () => ({ loadSiteAction: vi.fn(), publishSiteAction: vi.fn(), unpublishSiteAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
vi.mock("@/components/ui/dropdown-menu", async original => {
  const parts = await original<typeof import("@/components/ui/dropdown-menu")>();
  return { ...parts, DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <parts.DropdownMenuGroup>{children}</parts.DropdownMenuGroup> };
});
const company = { name: "Nexo", logo_url: "https://example.com/logo.png" };
function initial(): SiteState {
  const draft = defaultSiteDraft(); draft.slug = "nexo";
  const hero = draft.blocks[0]; if (hero.type === "hero") hero.content.title = "Únete";
  const closing = defaultBlock("closing"); if (closing.type === "closing") closing.content.title = "Crece";
  draft.blocks.push(closing);
  return { draft, draft_version: 7, published: null, has_unpublished_changes: false, media: [], updated_at: "2026-10-27T00:00:00Z" };
}
let controller: AutosaveController;
const onState = vi.fn(); const onNavigate = vi.fn(); const onConflict = vi.fn();
function mount({ role = "owner", incomplete = false, published = false, companyKnown = true } = {}) {
  const data = initial(); if (incomplete) data.draft.slug = null;
  if (published) data.published = { version: 7, slug: "nexo", published_at: data.updated_at };
  const save = vi.fn().mockImplementation(async ({ body }) => ({ kind: "success", data: { ...data, draft: body, draft_version: 8 }, etag: '"8"' }));
  controller = createAutosave(data, '"7"', save);
  const view = render(<TooltipProvider><SitePublication controller={controller} role={role} company={companyKnown ? company : { name: "", logo_url: null }} companyKnown={companyKnown} published={data.published} onState={onState} onNavigate={onNavigate} onConflict={onConflict} /></TooltipProvider>);
  return { data, save, ...view };
}
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); controller?.dispose(); vi.resetAllMocks(); vi.unstubAllGlobals(); });
async function prepare() { await act(async () => fireEvent.click(screen.getByRole("button", { name: "Publicar" }))); }
async function confirm() { await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Publicar sitio" }))); }
it("flushes first, confirms the exact saved version and initially focuses Cancelar", async () => {
  const { data, save } = mount();
  act(() => controller.dispatch({ type: "slug", slug: "new-slug" }));
  await prepare(); expect(save).toHaveBeenCalledOnce(); expect(publishSiteAction).not.toHaveBeenCalled();
  expect(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancelar" })).toHaveFocus();
  expect(screen.getByRole("alertdialog")).toHaveTextContent("/empresas/new-slug");
  const published = { ...data, draft_version: 8, published: { version: 8, slug: "new-slug", published_at: data.updated_at } };
  vi.mocked(publishSiteAction).mockResolvedValue({ kind: "success", data: published, etag: '"8"' });
  await confirm(); expect(publishSiteAction).toHaveBeenCalledExactlyOnceWith('"8"');
  expect(onState).toHaveBeenCalledWith(published);
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Sitio publicado", action: expect.objectContaining({ title: "Ver sitio" }) }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()); expect(screen.getByRole("status")).toHaveTextContent("Sitio publicado");
});
it("lets the server validate unknown company identity and displays its blocked issues", async () => {
  mount({ companyKnown: false });
  vi.mocked(publishSiteAction).mockResolvedValue({ kind: "error", code: "publish_blocked", issues: [{ code: "company_logo_missing", field: null }] });
  await prepare();
  expect(screen.getByRole("alertdialog")).toHaveTextContent("¿Publicar tu sitio?");
  await confirm();
  expect(publishSiteAction).toHaveBeenCalledExactlyOnceWith('"7"');
  expect(screen.getByRole("dialog", { name: "Antes de publicar" })).toHaveTextContent("Agrega el logo de la empresa");
});
it("concurrent confirmation clicks issue exactly one publish request", async () => {
  const { data } = mount(); let resolve!: (value: Awaited<ReturnType<typeof publishSiteAction>>) => void;
  vi.mocked(publishSiteAction).mockReturnValue(new Promise(done => { resolve = done; }));
  await prepare(); const button = within(screen.getByRole("alertdialog")).getByRole("button", { name: "Publicar sitio" });
  await act(async () => { fireEvent.click(button); fireEvent.click(button); });
  expect(publishSiteAction).toHaveBeenCalledExactlyOnceWith('"7"');
  await act(async () => resolve({ kind: "success", data, etag: '"7"' }));
  expect(publishSiteAction).toHaveBeenCalledOnce(); expect(onState).toHaveBeenCalledOnce();
});
it.each(["success", "conflict"] as const)("does not deliver %s publication callbacks or notifications after unmount", async kind => {
  const { data, unmount } = mount(); let resolve!: (value: Awaited<ReturnType<typeof publishSiteAction>>) => void;
  vi.mocked(publishSiteAction).mockReturnValue(new Promise(done => { resolve = done; }));
  await prepare(); await confirm(); expect(publishSiteAction).toHaveBeenCalledOnce(); unmount();
  await act(async () => resolve(kind === "success" ? { kind, data, etag: '"7"' } : { kind, current: { ...data, draft_version: 9 } }));
  expect(onState).not.toHaveBeenCalled(); expect(onConflict).not.toHaveBeenCalled(); expect(notifyActionResult).not.toHaveBeenCalled();
  expect(publishSiteAction).toHaveBeenCalledOnce();
});
it("never starts a publish after unmount while confirmation is flushing queued edits", async () => {
  const { data, save, unmount } = mount(); let resolve!: (value: SiteResult) => void;
  await prepare();
  save.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  act(() => controller.dispatch({ type: "slug", slug: "queued" })); await confirm();
  expect(save).toHaveBeenCalledOnce(); unmount(); controller.dispose();
  await act(async () => { await Promise.resolve(); });
  expect(publishSiteAction).not.toHaveBeenCalled(); expect(onState).not.toHaveBeenCalled(); expect(notifyActionResult).not.toHaveBeenCalled();
  await act(async () => resolve({ kind: "success", data: { ...data, draft: { ...data.draft, slug: "queued" }, draft_version: 8 }, etag: '"8"' }));
  expect(publishSiteAction).not.toHaveBeenCalled(); expect(notifyActionResult).not.toHaveBeenCalled();
});
it.each(["invalid", "conflict"] as const)("refuses publication and explains a real autosave %s outcome", async kind => {
  const { data, save } = mount(); const current = { ...data, draft_version: 9 };
  save.mockResolvedValue(kind === "invalid" ? { kind, fields: [{ field: "slug", code: "invalid" }] } : { kind, current });
  act(() => controller.dispatch({ type: "slug", slug: "new-slug" })); await prepare();
  expect(publishSiteAction).not.toHaveBeenCalled(); expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(kind === "invalid" ? "No publicamos. Revisa los campos marcados." : "Otra persona editó el sitio. Carga la versión más reciente.");
  if (kind === "conflict") expect(onConflict).toHaveBeenCalledWith(current);
  expect(controller.getSnapshot().editor.draft.slug).toBe("new-slug");
});
it("opens the client checklist and navigates slug to settings", async () => {
  mount({ incomplete: true }); await prepare();
  const dialog = screen.getByRole("dialog", { name: "Antes de publicar" }); expect(dialog).toHaveTextContent("Elige la dirección pública");
  expect(dialog.querySelector('[data-slot="dialog-header"]')).toHaveClass("pr-8");
  fireEvent.click(within(dialog).getByRole("button", { name: /Ir a la sección/ }));
  expect(onNavigate).toHaveBeenCalledWith({ tab: "settings" }); expect(publishSiteAction).not.toHaveBeenCalled();
});
it("handles server blocked issues, block navigation and company-settings links", async () => {
  const { data } = mount(); const blockId = data.draft.blocks[0].id;
  vi.mocked(publishSiteAction).mockResolvedValue({ kind: "error", code: "publish_blocked", issues: [{ code: "hero_title_missing", field: "blocks[0]" }, { code: "company_logo_missing", field: null }] });
  await prepare(); await confirm();
  const dialog = screen.getByRole("dialog", { name: "Antes de publicar" });
  expect(within(dialog).getByRole("link", { name: /Configuración de la empresa/ })).toHaveAttribute("href", "/empresa/configuracion");
  fireEvent.click(within(dialog).getByRole("button", { name: /Ir a la sección/ }));
  expect(onNavigate).toHaveBeenCalledWith({ tab: "sections", blockId });
});
it("maps server checklist indices against the published request snapshot, not later reorders", async () => {
  const { data } = mount(); let resolve!: (value: Awaited<ReturnType<typeof publishSiteAction>>) => void;
  vi.mocked(publishSiteAction).mockReturnValue(new Promise(done => { resolve = done; }));
  await prepare();
  await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Publicar sitio" })));
  act(() => controller.dispatch({ type: "move", id: data.draft.blocks[0].id, direction: 1 }));
  await act(async () => resolve({ kind: "error", code: "publish_blocked", issues: [{ code: "hero_title_missing", field: "blocks[0]" }] }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Antes de publicar" })).getByRole("button", { name: /Ir a la sección/ }));
  expect(onNavigate).toHaveBeenCalledWith({ tab: "sections", blockId: data.draft.blocks[0].id });
});
it("routes a publish 412 to explicit reload recovery without changing local edits", async () => {
  const { data } = mount(); const current = { ...data, draft_version: 9 };
  vi.mocked(publishSiteAction).mockResolvedValue({ kind: "conflict", current });
  await prepare(); await confirm(); expect(onConflict).toHaveBeenCalledWith(current);
  expect(screen.getByRole("status")).toHaveTextContent("Otra persona editó el sitio");
  expect(controller.getSnapshot().editor.draft_version).toBe(7);
});
it.each(["uncertain", "unauthenticated", "unrecognized"] as const)("refuses publication when flush returns %s", async kind => {
  mount(); controller.dispose(); const save = vi.fn().mockResolvedValue({ kind });
  cleanup(); const data = initial(); controller = createAutosave(data, '"7"', save);
  render(<TooltipProvider><SitePublication controller={controller} role="owner" company={company} published={null} onState={onState} onNavigate={onNavigate} onConflict={onConflict} /></TooltipProvider>);
  act(() => controller.dispatch({ type: "slug", slug: "new-slug" })); await prepare();
  expect(publishSiteAction).not.toHaveBeenCalled(); expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(kind === "unauthenticated" ? "Tu sesión expiró" : "No publicamos");
});
it("does not publish edits made after confirmation was prepared without renewed consent", async () => {
  mount(); await prepare(); act(() => controller.dispatch({ type: "slug", slug: "new-slug" })); await confirm();
  expect(publishSiteAction).not.toHaveBeenCalled(); expect(screen.getByRole("alertdialog")).toHaveTextContent("El borrador cambió");
});
it("keeps recruiter publication disabled with the owner-only reason", () => {
  mount({ role: "recruiter" }); expect(screen.getByRole("button", { name: "Publicar" })).toBeDisabled();
  expect(screen.getByLabelText("Solo la persona dueña de la empresa puede publicar")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Acciones de publicación" })).not.toBeInTheDocument();
});
it("checks an uncertain publication with a read, never a second POST", async () => {
  const { data } = mount();
  vi.mocked(publishSiteAction).mockResolvedValue({ kind: "uncertain" });
  await prepare(); await confirm();
  expect(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Publicar sitio" })).toBeDisabled();
  const published = { ...data, published: { version: 7, slug: "nexo", published_at: data.updated_at } };
  vi.mocked(loadSiteAction).mockResolvedValue({ kind: "success", data: published, etag: '"7"' });
  await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Comprobar estado" })));
  expect(loadSiteAction).toHaveBeenCalledOnce(); expect(publishSiteAction).toHaveBeenCalledOnce();
  expect(onState).toHaveBeenCalledWith(published);
  expect(notifyActionResult).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Sitio publicado", type: "success" }));
});
it("unpublishes only after its own confirmation", async () => {
  const { data } = mount({ published: true });
  fireEvent.click(screen.getByRole("menuitem", { name: "Despublicar" }));
  expect(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancelar" })).toHaveFocus();
  vi.mocked(unpublishSiteAction).mockResolvedValue({ kind: "success", data: { ...data, published: null }, etag: '"7"' });
  await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Despublicar sitio" })));
  expect(unpublishSiteAction).toHaveBeenCalledOnce(); expect(onState).toHaveBeenCalledWith(expect.objectContaining({ published: null }));
  expect(screen.getByRole("status")).toHaveTextContent("Sitio despublicado");
});

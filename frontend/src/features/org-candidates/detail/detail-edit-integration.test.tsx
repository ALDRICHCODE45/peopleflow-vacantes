import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OrgCandidateDetailSheet } from "./detail-sheet";
import { loadOrgCandidateDetailAction } from "./detail-actions";
import { editFixture } from "../edit/test-fixtures";
import { saveOrgCandidateEditAction } from "../edit/edit-actions";
import { loadOrgCandidateHistoryAction } from "../history/history-actions";
vi.mock("./detail-actions", () => ({ loadOrgCandidateDetailAction: vi.fn() }));
vi.mock("../edit/edit-actions", () => ({ saveOrgCandidateEditAction: vi.fn() }));
vi.mock("../history/history-actions", () => ({ loadOrgCandidateHistoryAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
vi.mock("@/features/languages/use-language-catalog", () => ({ useLanguageCatalog: () => ({ status: "success", data: { items: [{ code: "es", name: "Español" }] } }) }));
vi.mock("@/features/geo/use-geo-catalog", () => ({ useGeoCatalog: () => ({ countries: { status: "success", data: { items: [] } }, states: { status: "success", data: { items: [] } }, municipalities: { status: "success", data: { items: [] } } }), useGeoPostalCode: () => ({ status: "idle" }) }));
beforeEach(() => {
 vi.resetAllMocks();
 vi.mocked(loadOrgCandidateDetailAction).mockResolvedValue({ ok: true, data: editFixture() });
 vi.mocked(loadOrgCandidateHistoryAction).mockResolvedValue({ ok: true, data: { items: [], next_cursor: null } });
});
afterEach(cleanup);
function open() {
 const candidate = editFixture(); const onOpenChange = vi.fn(); const onCandidateUpdated = vi.fn();
 render(<OrgCandidateDetailSheet candidate={candidate} onOpenChange={onOpenChange} onCandidateUpdated={onCandidateUpdated} />);
 return { onOpenChange, onCandidateUpdated };
}
async function edit() { fireEvent.click(await screen.findByRole("button", { name: "Editar datos" })); }
async function save() {
 fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
 const dialog = await screen.findByRole("alertdialog");
 await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Guardar cambios" })); });
}
it("opens the edit form in the same Sheet and hides read sections", async () => {
 open(); await edit();
 expect(screen.getByLabelText("Nombre completo")).toHaveValue("Lucía Ramírez Torres");
 expect(document.querySelectorAll('[data-slot="sheet-content"]')).toHaveLength(1);
 expect(screen.queryByRole("region", { name: "Procesos" })).not.toBeInTheDocument();
 expect(screen.queryByRole("region", { name: "Historial de cambios" })).not.toBeInTheDocument();
});
it.each(["Escape", "X", "outside"])("guards dirty %s dismissal and confirmed discard returns to read view without closing", async method => {
 const { onOpenChange } = open(); await edit();
 fireEvent.change(screen.getByLabelText("Nombre completo"), { target: { value: "Nombre sin guardar" } });
 if (method === "Escape") fireEvent.keyDown(screen.getByLabelText("Nombre completo"), { key: "Escape" });
 else if (method === "X") fireEvent.click(screen.getByRole("button", { name: "Cerrar ficha" }));
 else {
  const overlay = document.querySelector('[data-slot="sheet-overlay"]')!;
  fireEvent.mouseDown(overlay); fireEvent.mouseUp(overlay); fireEvent.click(overlay);
 }
 expect(await screen.findByRole("alertdialog")).toHaveTextContent("Tienes cambios sin guardar");
 expect(onOpenChange).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button", { name: "Seguir editando" }));
 expect(screen.getByLabelText("Nombre completo")).toHaveValue("Nombre sin guardar");
 fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
 fireEvent.click(await screen.findByRole("button", { name: "Descartar" }));
 expect(await screen.findByRole("region", { name: "Contacto" })).toBeVisible();
 expect(screen.queryByLabelText("Nombre completo")).not.toBeInTheDocument();
 expect(onOpenChange).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button", { name: "Cerrar ficha" }));
 expect(onOpenChange).toHaveBeenCalledWith(false);
});
it("refreshes a conflict without remounting, preserving edits and adopting fresh untouched fields", async () => {
 const data = editFixture();
 vi.mocked(saveOrgCandidateEditAction).mockResolvedValue({ ok: false, reason: "precondition_failed", reference: { status: 412 } });
 vi.mocked(loadOrgCandidateDetailAction).mockResolvedValueOnce({ ok: true, data }).mockResolvedValueOnce({ ok: true, data: { ...data, etag: '\"v2\"', professional_title: "Otro título", current_company: "Nueva empresa" } });
 const { onOpenChange } = open(); await edit();
 const input = screen.getByLabelText("Título profesional");
 fireEvent.change(input, { target: { value: "Mi título" } }); await save();
 await waitFor(() => expect(screen.getByLabelText("Empresa actual")).toHaveValue("Nueva empresa"));
 expect(screen.getByLabelText("Título profesional")).toBe(input);
 expect(input).toHaveValue("Mi título");
 expect(screen.getByText("Alguien más cambió este dato")).toBeVisible();
 expect(loadOrgCandidateDetailAction).toHaveBeenCalledTimes(2);
 expect(onOpenChange).not.toHaveBeenCalled();
});
it("keeps the edit mounted and offers retry when the conflict read fails", async () => {
 vi.mocked(saveOrgCandidateEditAction).mockResolvedValue({ ok: false, reason: "precondition_failed", reference: { status: 412 } });
 vi.mocked(loadOrgCandidateDetailAction).mockResolvedValueOnce({ ok: true, data: editFixture() }).mockResolvedValueOnce({ ok: false, reason: "server_error", reference: {} });
 open(); await edit(); const input = screen.getByLabelText("Título profesional");
 fireEvent.change(input, { target: { value: "Mi título" } }); await save();
 expect(screen.getByLabelText("Título profesional")).toBe(input);
 expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
 expect(screen.getByRole("button", { name: "Actualizar datos" })).toBeVisible();
});
it("adopts the save in read view, notifies the list, and refreshes history", async () => {
 const saved = { ...editFixture(), full_name: "Lucía Corregida", etag: '\"v2\"' };
 vi.mocked(saveOrgCandidateEditAction).mockResolvedValue({ ok: true, data: saved });
 const { onCandidateUpdated } = open();
 await screen.findByRole("region", { name: "Historial de cambios" });
 expect(loadOrgCandidateHistoryAction).toHaveBeenCalledTimes(1);
 await edit(); fireEvent.change(screen.getByLabelText("Nombre completo"), { target: { value: saved.full_name } }); await save();
 expect(await screen.findByRole("heading", { name: saved.full_name })).toBeVisible();
 expect(screen.getByRole("region", { name: "Contacto" })).toBeVisible();
 expect(onCandidateUpdated).toHaveBeenCalledExactlyOnceWith(saved);
 await waitFor(() => expect(loadOrgCandidateHistoryAction).toHaveBeenCalledTimes(2));
});
it("shows last editor, effective skills and links, corrected badges and history after Procesos", async () => {
 const data = { ...editFixture("organic"), updated_at: "2026-10-22T18:00:00Z", updated_by: { id: editFixture().id, name: "Ana Ríos" }, corrected_fields: ["email", "skills", "linkedin_url", "seniority"] as const, skills: ["TypeScript"], portfolio_url: "https://example.com/lucia" };
 vi.mocked(loadOrgCandidateDetailAction).mockResolvedValue({ ok: true, data: { ...data, corrected_fields: [...data.corrected_fields] } });
 open();
 expect(await screen.findByText(/Editado por Ana Ríos el/)).toBeVisible();
 const profile = screen.getByRole("region", { name: "Perfil" });
 expect(within(profile).getByText("TypeScript")).toBeVisible();
 expect(within(profile).queryByText("React")).not.toBeInTheDocument();
 expect(within(profile).getByRole("link", { name: "LinkedIn" })).toHaveAttribute("href", data.linkedin_url);
 expect(within(profile).getByRole("link", { name: "Portafolio" })).toHaveAttribute("href", data.portfolio_url);
 expect(within(screen.getByRole("region", { name: "Contacto" })).getAllByText("Corregido")).toHaveLength(1);
 expect(within(profile).getAllByText("Corregido")).toHaveLength(3);
 for (const badge of screen.getAllByText("Corregido")) expect(badge).toHaveAttribute("data-slot", "badge");
 const history = screen.getByRole("region", { name: "Historial de cambios" });
 expect(screen.getByRole("region", { name: "Procesos" }).compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

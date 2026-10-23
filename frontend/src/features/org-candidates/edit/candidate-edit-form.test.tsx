import { createRef, type ComponentProps, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CandidateEditForm, type CandidateEditFormHandle } from "./candidate-edit-form";
import { saveOrgCandidateEditAction } from "./edit-actions";
import { notifyActionResult } from "@/components/feedback/notify";
import { editFixture } from "./test-fixtures";
import { CANDIDATE_EDIT_CONFLICT_NOTICE } from "./edit-model";
// As in manual-intake tests, jsdom cannot model Base UI Select's portal/focus
// restoration. Keep labels, values and changes; real popovers remain browser QA.
vi.mock("@/components/ui/select", async () => {
 const React = await import("react");
 const Context = React.createContext({ value: "", items: [] as { value: string; label: string }[], change: (value: string) => { void value; } });
 return {
  Select: ({ value, items, onValueChange, children }: { value: string; items: { value: string; label: string }[]; onValueChange: (value: string) => void; children: ReactNode }) => <Context.Provider value={{ value, items, change: onValueChange }}>{children}</Context.Provider>,
  SelectTrigger: (props: ComponentProps<"select">) => { const state = React.useContext(Context); return <select {...props} value={state.value ?? ""} onChange={event => state.change(event.target.value)}><option value="">Elige una opción</option>{state.items.filter(item => item.value).map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>; },
  SelectValue: () => null, SelectContent: () => null, SelectGroup: () => null, SelectItem: () => null,
 };
});
vi.mock("./edit-actions", () => ({ saveOrgCandidateEditAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
vi.mock("@/features/languages/use-language-catalog", () => ({ useLanguageCatalog: () => ({ status: "success", data: { items: [{ code: "es", name: "Español" }] } }) }));
vi.mock("@/features/geo/use-geo-catalog", () => ({ useGeoCatalog: () => ({ countries: { status: "success", data: { items: [{ id: "MX", name: "México" }] } }, states: { status: "success", data: { items: [] } }, municipalities: { status: "success", data: { items: [] } } }), useGeoPostalCode: () => ({ status: "idle" }) }));
afterEach(cleanup);
beforeEach(() => vi.resetAllMocks());
const change = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } });
async function openSaveConfirmation() {
 fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
 return screen.findByRole("alertdialog");
}
function summaryRow(dialog: HTMLElement, label: string) {
 const term = within(dialog).getByText(label, { selector: "dt" });
 expect(term.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
 return term.parentElement!;
}
async function save() {
 const dialog = await openSaveConfirmation();
 await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Guardar cambios" })); });
}
it.each(["manual", "organic"] as const)("mirrors summary section order and groups the %s professional profile", kind => {
 const { container } = render(<CandidateEditForm candidate={editFixture(kind)} onSaved={vi.fn()} onCancel={vi.fn()} onConflict={vi.fn()} />);
 const sections = container.querySelectorAll('form > div > fieldset > [data-slot="field-group"] > fieldset');
 expect(Array.from(sections, section => section.querySelector(':scope > legend')?.textContent)).toEqual(["Contacto", "Perfil profesional", "Enlaces", "Habilidades"]);
 const profile = screen.getByRole("group", { name: "Perfil profesional" });
 const groups = Array.from(profile.querySelectorAll(':scope > [data-slot="field-group"] > fieldset'));
 expect(groups.map(group => group.querySelector(':scope > legend')?.textContent)).toEqual(["Ubicación", "Estudios", "Idiomas"]);
 const orderedControls = [groups[0], within(profile).getByLabelText("Años de experiencia"), within(profile).getByLabelText("Seniority"), groups[1], groups[2]];
 orderedControls.slice(1).forEach((control, index) => expect(orderedControls[index].compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy());
 expect(within(profile).getByLabelText("Título profesional")).toBeVisible();
 expect(within(profile).getByLabelText("Empresa actual")).toBeVisible();
});
it("keeps footer actions outside the scrolling fields and usable on narrow sheets", () => {
 const { container } = render(<CandidateEditForm candidate={editFixture()} onSaved={vi.fn()} onCancel={vi.fn()} onConflict={vi.fn()} />);
 const footer = container.querySelector('[data-slot="sheet-footer"]')!;
 const scroller = container.querySelector('form > div')!;
 expect(scroller).toHaveClass("min-h-0", "flex-1", "overflow-y-auto", "overscroll-contain");
 expect(footer.parentElement).toBe(scroller.parentElement);
 expect(footer).toHaveClass("sticky", "bottom-0", "shrink-0", "bg-card");
 const cancel = within(footer as HTMLElement).getByRole("button", { name: "Cancelar" });
 const save = within(footer as HTMLElement).getByRole("button", { name: "Guardar cambios" });
 expect(cancel).toHaveClass("border-border", "bg-background");
 expect(save).toHaveClass("bg-primary", "text-primary-foreground");
 expect(cancel).toHaveClass("min-h-10"); expect(save).toHaveClass("min-h-10");
 expect(cancel.parentElement).toBe(footer);
 expect(save.closest('[data-pf-action-bar]')).not.toBeNull();
 expect(save).toBeDisabled();
 expect(screen.getByLabelText("Lada de país").closest('[data-slot="field-group"]')).toHaveClass("grid-cols-1");
});
it("prefills the full manual values and sends only edits, then notifies", async () => {
 const candidate = editFixture(); const onSaved = vi.fn();
 vi.mocked(saveOrgCandidateEditAction).mockResolvedValue({ ok: true, data: { ...candidate, professional_title: "Ingeniera", etag: '"v2"' } });
 render(<CandidateEditForm candidate={candidate} onSaved={onSaved} onCancel={vi.fn()} onConflict={vi.fn()} />);
 expect(screen.getByLabelText("Nombre completo")).toHaveValue(candidate.full_name);
 expect(screen.getByLabelText("Lada de país")).toHaveValue("+52"); expect(screen.getByLabelText("Teléfono")).toHaveValue("3312345678");
 expect(screen.getByLabelText("Años de experiencia")).toHaveValue("4.5");
 change("Título profesional", "Ingeniera"); await save();
 expect(saveOrgCandidateEditAction).toHaveBeenCalledWith({ kind: candidate.kind, id: candidate.id }, '"v1"', { set: { professional_title: "Ingeniera" } });
 expect(onSaved).toHaveBeenCalled(); expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Cambios guardados" }));
 // Manual records have no candidate profile, so «solo para tu empresa» would mislead (QA L15).
 expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ description: "Los cambios quedaron en el historial de cambios del candidato." }));
});
it("tells organic saves that only the company's data changed", async () => {
 const candidate = editFixture("organic");
 vi.mocked(saveOrgCandidateEditAction).mockResolvedValue({ ok: true, data: { ...candidate, professional_title: "Ingeniera", etag: '"v2"' } });
 render(<CandidateEditForm candidate={candidate} onSaved={vi.fn()} onCancel={vi.fn()} onConflict={vi.fn()} />);
 change("Título profesional", "Ingeniera"); await save();
 expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success", description: "Los datos se actualizaron solo para tu empresa." }));
});
it("groups correction metadata under one direct Field child with an intrinsic restore action", () => {
 const candidate = editFixture("organic"); candidate.professional_title = "Corregido"; candidate.corrected_fields = ["professional_title"];
 candidate.original!.professional_title = "Original".repeat(80);
 render(<CandidateEditForm candidate={candidate} onSaved={vi.fn()} onCancel={vi.fn()} onConflict={vi.fn()} />);
 const field = screen.getByLabelText("Título profesional").closest('[data-slot="field"]')!;
 const badge = within(field as HTMLElement).getByText("Corregido", { selector: '[data-slot="badge"]' });
 const action = within(field as HTMLElement).getByRole("button", { name: "Restaurar original" });
 const block = badge.parentElement!;
 expect(block).toHaveAttribute("data-edit-correction"); expect(block.parentElement).toBe(field);
 expect(action.parentElement).toBe(block); expect(action).not.toHaveClass("w-full"); expect(action).toHaveClass("min-h-10");
 // Link actions sit flush with the badge when the block wraps (optical alignment, QA L20).
 expect(action).toHaveClass("px-0");
 expect(block).toHaveClass("flex", "flex-wrap", "items-center", "gap-x-2", "gap-y-1", "rounded-lg", "bg-muted", "p-3");
 expect(action.querySelector('svg.lucide-rotate-ccw[data-icon="inline-start"][aria-hidden="true"]')).not.toBeNull();
 const original = within(block).getByText(`Original: ${candidate.original!.professional_title}`);
 expect(original).toHaveAttribute("data-slot", "field-description"); expect(original).toHaveClass("min-w-0", "break-words");
});
it("keeps uncorrected organic education as reference text only in the same block layout", () => {
 render(<CandidateEditForm candidate={editFixture("organic")} onSaved={vi.fn()} onCancel={vi.fn()} onConflict={vi.fn()} />);
 const original = screen.getByText("Original: Licenciatura o Ingeniería · Maestría en curso");
 const block = original.parentElement!;
 expect(block).toHaveAttribute("data-edit-correction");
 expect(block).toHaveClass("flex", "flex-wrap", "items-center", "gap-x-2", "gap-y-1");
 expect(block.children).toHaveLength(1); expect(block.querySelector('[data-slot="badge"],button')).toBeNull();
});
it("shows corrected/original organic fields and supports restoring and undoing", async () => {
 const candidate = editFixture("organic"); candidate.professional_title = "Corregido"; candidate.corrected_fields = ["professional_title"];
 candidate.original = { full_name: candidate.full_name, contact: candidate.contact, professional_title: "Original", current_company: null, profile: candidate.profile, education: null, linkedin_url: null, portfolio_url: null };
 render(<CandidateEditForm candidate={candidate} onSaved={vi.fn()} onCancel={vi.fn()} onConflict={vi.fn()} />);
 expect(screen.getByText("Corregido", { selector: '[data-slot="badge"]' })).toBeVisible(); expect(screen.getByText("Original: Original")).toBeVisible();
 expect(screen.getByText("Original: Licenciatura o Ingeniería · Maestría en curso")).toBeVisible();
 const block = screen.getByRole("button", { name: "Restaurar original" }).parentElement!;
 fireEvent.click(screen.getByRole("button", { name: "Restaurar original" })); expect(screen.getByLabelText("Título profesional")).toHaveValue("Original");
 expect(within(block).getByText("Se restaurará el original al guardar")).toBeVisible();
 expect(within(block).getByRole("button", { name: "Deshacer restauración" })).toHaveClass("min-h-10");
 fireEvent.click(within(block).getByRole("button", { name: "Deshacer restauración" })); expect(screen.getByLabelText("Título profesional")).toHaveValue("Corregido");
 expect(within(block).queryByText("Se restaurará el original al guardar")).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button", { name: "Restaurar original" }));
 vi.mocked(saveOrgCandidateEditAction).mockResolvedValue({ ok: true, data: candidate }); await save();
 expect(saveOrgCandidateEditAction).toHaveBeenCalledWith(expect.anything(), candidate.etag, { set: {}, reset: ["professional_title"] });
});
it("describes manual saves without implying a candidate profile exists", async () => {
 render(<CandidateEditForm candidate={editFixture()} onSaved={vi.fn()} onCancel={vi.fn()} onConflict={vi.fn()} />);
 change("Título profesional", "Ingeniera");
 const dialog = await openSaveConfirmation();
 expect(within(dialog).getByText("Los cambios quedarán en el historial de cambios del candidato.")).toBeVisible();
 expect(within(dialog).queryByText(/El perfil del candidato no cambia/)).not.toBeInTheDocument();
});
it("preserves the organic company-only and unchanged-profile consequence", async () => {
 render(<CandidateEditForm candidate={editFixture("organic")} onSaved={vi.fn()} onCancel={vi.fn()} onConflict={vi.fn()} />);
 change("Título profesional", "Ingeniera");
 const dialog = await openSaveConfirmation();
 expect(within(dialog).getByText("Solo se actualizarán los datos de tu empresa. El perfil del candidato no cambia.")).toBeVisible();
});
it("summarizes only set fields with their normalized new values, including contact", async () => {
 render(<CandidateEditForm candidate={editFixture()} onSaved={vi.fn()} onCancel={vi.fn()} onConflict={vi.fn()} />);
 change("Nombre completo", "  Lucía López  "); change("Correo electrónico", "nueva@example.com");
 change("Teléfono", "3398765432"); change("Título profesional", "  Ingeniera  ");
 const dialog = await openSaveConfirmation();
 const details = dialog.querySelector('[data-slot="confirm-action-details"]')!;
 expect(details).not.toBeNull(); expect(details.querySelectorAll("dt")).toHaveLength(4);
 for (const [label, value] of [["Nombre completo", "Lucía López"], ["Correo", "nueva@example.com"], ["Teléfono", "+523398765432"], ["Título profesional", "Ingeniera"]]) {
  expect(within(summaryRow(details as HTMLElement, label)).getByText(value, { selector: "dd" })).toBeVisible();
 }
 expect(saveOrgCandidateEditAction).not.toHaveBeenCalled();
});
it("summarizes organic resets separately from set values", async () => {
 const candidate = editFixture("organic"); candidate.professional_title = "Corregido"; candidate.corrected_fields = ["professional_title"];
 render(<CandidateEditForm candidate={candidate} onSaved={vi.fn()} onCancel={vi.fn()} onConflict={vi.fn()} />);
 fireEvent.click(screen.getByRole("button", { name: "Restaurar original" })); change("Empresa actual", "Acme");
 const dialog = await openSaveConfirmation();
 expect(dialog.querySelectorAll("dt")).toHaveLength(2);
 expect(within(summaryRow(dialog, "Título profesional")).getByText("Se restaurará el original", { selector: "dd" })).toBeVisible();
 expect(within(summaryRow(dialog, "Empresa actual")).getByText("Acme", { selector: "dd" })).toBeVisible();
});
it("summarizes cleared values as Sin dato", async () => {
 render(<CandidateEditForm candidate={editFixture()} onSaved={vi.fn()} onCancel={vi.fn()} onConflict={vi.fn()} />);
 change("Teléfono", ""); change("Habilidades", "");
 const dialog = await openSaveConfirmation();
 for (const label of ["Teléfono", "Habilidades"]) expect(within(summaryRow(dialog, label)).getByText("Sin dato", { selector: "dd" })).toBeVisible();
});
it("submits exactly the validated body shown, without recomputing from a later draft", async () => {
 const candidate = editFixture("organic"); candidate.professional_title = "Corregido"; candidate.corrected_fields = ["professional_title"];
 vi.mocked(saveOrgCandidateEditAction).mockResolvedValue({ ok: true, data: candidate });
 render(<CandidateEditForm candidate={candidate} onSaved={vi.fn()} onCancel={vi.fn()} onConflict={vi.fn()} />);
 change("Nombre completo", "  Lucía López  "); change("Habilidades", " TypeScript, typescript, React ");
 fireEvent.click(screen.getByRole("button", { name: "Restaurar original" }));
 const dialog = await openSaveConfirmation();
 expect(dialog.querySelectorAll("dt")).toHaveLength(3);
 expect(within(summaryRow(dialog, "Nombre completo")).getByText("Lucía López", { selector: "dd" })).toBeVisible();
 expect(within(summaryRow(dialog, "Habilidades")).getByText("typescript; react", { selector: "dd" })).toBeVisible();
 expect(within(summaryRow(dialog, "Título profesional")).getByText("Se restaurará el original", { selector: "dd" })).toBeVisible();
 // A programmatic draft change cannot silently change the payload already confirmed.
 change("Habilidades", "Vue");
 expect(within(summaryRow(dialog, "Habilidades")).getByText("typescript; react", { selector: "dd" })).toBeVisible();
 await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Guardar cambios" })); });
 expect(saveOrgCandidateEditAction).toHaveBeenCalledExactlyOnceWith({ kind: candidate.kind, id: candidate.id }, candidate.etag, {
  set: { full_name: "Lucía López", skills: ["typescript", "react"] }, reset: ["professional_title"],
 });
});
it("cancels without writing and builds a fresh summary on reopening", async () => {
 render(<CandidateEditForm candidate={editFixture()} onSaved={vi.fn()} onCancel={vi.fn()} onConflict={vi.fn()} />);
 change("Empresa actual", "Primera empresa");
 const first = await openSaveConfirmation();
 fireEvent.click(within(first).getByRole("button", { name: "Cancelar" }));
 expect(saveOrgCandidateEditAction).not.toHaveBeenCalled();
 change("Empresa actual", "Otra empresa");
 const reopened = await openSaveConfirmation();
 expect(within(summaryRow(reopened, "Empresa actual")).getByText("Otra empresa", { selector: "dd" })).toBeVisible();
 expect(within(reopened).queryByText("Primera empresa")).not.toBeInTheDocument();
});
it("guards cancel and sheet close requests, but not a clean cancel", async () => {
 const cancel = vi.fn(); const ref = createRef<CandidateEditFormHandle>();
 render(<CandidateEditForm ref={ref} candidate={editFixture()} onSaved={vi.fn()} onCancel={cancel} onConflict={vi.fn()} />);
 fireEvent.click(screen.getByRole("button", { name: "Cancelar" })); expect(cancel).toHaveBeenCalledTimes(1); cancel.mockClear();
 change("Nombre completo", "Otro nombre"); act(() => ref.current?.requestClose());
 expect(cancel).not.toHaveBeenCalled(); expect(await screen.findByText("Tienes cambios sin guardar")).toBeVisible();
 fireEvent.click(screen.getByRole("button", { name: "Seguir editando" })); expect(screen.getByLabelText("Nombre completo")).toHaveValue("Otro nombre");
 fireEvent.click(screen.getByRole("button", { name: "Cancelar" })); fireEvent.click(await screen.findByRole("button", { name: "Descartar" })); expect(cancel).toHaveBeenCalledTimes(1);
});
it("preserves dirty values after 412, adopts untouched fresh data and warns on overlapping edits", async () => {
 const candidate = editFixture(); const conflict = vi.fn();
 vi.mocked(saveOrgCandidateEditAction).mockResolvedValue({ ok: false, reason: "precondition_failed", reference: { status: 412 } });
 const props = { onSaved: vi.fn(), onCancel: vi.fn(), onConflict: conflict };
 const view = render(<CandidateEditForm candidate={candidate} {...props} />);
 change("Título profesional", "Mi título"); await save(); expect(conflict).toHaveBeenCalledTimes(1);
 expect(screen.getByText(CANDIDATE_EDIT_CONFLICT_NOTICE)).toBeVisible();
 // Inline notices use the review tone and a warning icon, never muted text (rules §13.5, QA L16).
 const notice = screen.getByText(CANDIDATE_EDIT_CONFLICT_NOTICE).closest("[role=status]")!;
 expect(notice).toHaveClass("text-status-review"); expect(notice).not.toHaveClass("text-muted-foreground"); expect(notice.querySelector("svg[aria-hidden=true]")).not.toBeNull(); expect(screen.getByLabelText("Título profesional")).toHaveValue("Mi título");
 const fresh = { ...candidate, etag: '"v2"', professional_title: "Título de otra persona", current_company: "Empresa nueva" };
 view.rerender(<CandidateEditForm candidate={fresh} {...props} />);
 expect(screen.getByLabelText("Título profesional")).toHaveValue("Mi título"); expect(screen.getByLabelText("Empresa actual")).toHaveValue("Empresa nueva");
 expect(screen.getByText(/Alguien más cambió este dato/)).toBeVisible(); expect(screen.getByText(/Título de otra persona/)).toBeVisible();
 vi.mocked(saveOrgCandidateEditAction).mockResolvedValue({ ok: true, data: fresh }); await save();
 expect(saveOrgCandidateEditAction).toHaveBeenLastCalledWith(expect.anything(), '"v2"', { set: { professional_title: "Mi título" } });
});
it("starts uncorrected organic education empty and never sends synthesized study rows", async () => {
 const candidate = editFixture("organic"); vi.mocked(saveOrgCandidateEditAction).mockResolvedValue({ ok: true, data: candidate });
 render(<CandidateEditForm candidate={candidate} onSaved={vi.fn()} onCancel={vi.fn()} onConflict={vi.fn()} />);
 expect(screen.queryByLabelText("Institución")).not.toBeInTheDocument();
 expect(screen.getByText("Original: Licenciatura o Ingeniería · Maestría en curso")).toBeVisible();
 change("Portafolio", "https://example.com"); await save();
 expect(saveOrgCandidateEditAction).toHaveBeenCalledWith(expect.anything(), candidate.etag, { set: { portfolio_url: "https://example.com" } });
});
it("replaces the complete manual education array when one study changes", async () => {
 const study = { level: "bachelor" as const, status: "completed" as const, institution: "UNAM", field: "Ingeniería", start_year: 2014, end_year: 2018 };
 const candidate = { ...editFixture(), education: [study] }; vi.mocked(saveOrgCandidateEditAction).mockResolvedValue({ ok: true, data: candidate });
 render(<CandidateEditForm candidate={candidate} onSaved={vi.fn()} onCancel={vi.fn()} onConflict={vi.fn()} />);
 change("Institución", "IPN"); await save();
 expect(saveOrgCandidateEditAction).toHaveBeenCalledWith(expect.anything(), candidate.etag, { set: { education: [{ ...study, institution: "IPN" }] } });
});
it("uses null for cleared phone and skills while retaining the other contact", async () => {
 const candidate = editFixture(); vi.mocked(saveOrgCandidateEditAction).mockResolvedValue({ ok: true, data: candidate });
 render(<CandidateEditForm candidate={candidate} onSaved={vi.fn()} onCancel={vi.fn()} onConflict={vi.fn()} />);
 change("Teléfono", ""); change("Habilidades", ""); await save();
 expect(saveOrgCandidateEditAction).toHaveBeenCalledWith(expect.anything(), candidate.etag, { set: { phone: null, skills: null } });
});
it("does not send local validation failures and focuses the first bad control", async () => {
 render(<CandidateEditForm candidate={editFixture()} onSaved={vi.fn()} onCancel={vi.fn()} onConflict={vi.fn()} />);
 change("Nombre completo", ""); change("Teléfono", "12"); fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
 await waitFor(() => expect(screen.getByLabelText("Nombre completo")).toHaveFocus());
 expect(saveOrgCandidateEditAction).not.toHaveBeenCalled(); expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});
it("keeps the draft after a failed conflict read and prevents saving the stale etag", async () => {
 const candidate = editFixture(); const conflict = vi.fn().mockRejectedValue(new Error("No response"));
 vi.mocked(saveOrgCandidateEditAction).mockResolvedValue({ ok: false, reason: "precondition_failed", reference: { status: 412 } });
 render(<CandidateEditForm candidate={candidate} onSaved={vi.fn()} onCancel={vi.fn()} onConflict={conflict} />);
 change("Título profesional", "Mi título"); await save();
 expect(screen.getByLabelText("Título profesional")).toHaveValue("Mi título"); expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
 expect(screen.getByRole("button", { name: "Actualizar datos" })).toBeEnabled(); expect(saveOrgCandidateEditAction).toHaveBeenCalledTimes(1);
});
it("focuses validation in visual order, including a shared contact error", async () => {
 const candidate = editFixture();
 vi.mocked(saveOrgCandidateEditAction).mockResolvedValue({ ok: false, reason: "validation_error", fields: [{ field: "portfolio_url", code: "invalid" }, { field: "phone", code: "invalid" }, { field: "contact", code: "required" }], reference: { status: 400 } });
 render(<CandidateEditForm candidate={candidate} onSaved={vi.fn()} onCancel={vi.fn()} onConflict={vi.fn()} />);
 change("Título profesional", "Otra cosa"); await save();
 await waitFor(() => expect(screen.getByLabelText("Correo electrónico")).toHaveFocus());
 expect(screen.getByText("Agrega un correo o un teléfono.")).toBeVisible();
});
it("focuses the first editable study field for a collection error, not its remove action", async () => {
 vi.mocked(saveOrgCandidateEditAction).mockResolvedValue({ ok: false, reason: "validation_error", fields: [{ field: "education", code: "invalid" }], reference: { status: 400 } });
 const candidate = { ...editFixture(), education: [{ level: "bachelor" as const, status: "completed" as const, institution: "UNAM", field: null, start_year: null, end_year: null }] };
 render(<CandidateEditForm candidate={candidate} onSaved={vi.fn()} onCancel={vi.fn()} onConflict={vi.fn()} />);
 change("Título profesional", "Otra cosa"); await save();
 await waitFor(() => expect(screen.getByLabelText("Nivel")).toHaveFocus());
});
it("focuses indexed education errors without hiding them", async () => {
 vi.mocked(saveOrgCandidateEditAction).mockResolvedValue({ ok: false, reason: "validation_error", fields: [{ field: "education[0].institution", code: "invalid" }], reference: { status: 400 } });
 const candidate = { ...editFixture(), education: [{ level: "bachelor" as const, status: "completed" as const, institution: "UNAM", field: null, start_year: null, end_year: null }] };
 render(<CandidateEditForm candidate={candidate} onSaved={vi.fn()} onCancel={vi.fn()} onConflict={vi.fn()} />);
 expect(screen.getByLabelText("Institución")).toHaveValue("UNAM"); change("Título profesional", "Otra cosa"); await save();
 await waitFor(() => expect(screen.getByLabelText("Institución")).toHaveFocus());
});

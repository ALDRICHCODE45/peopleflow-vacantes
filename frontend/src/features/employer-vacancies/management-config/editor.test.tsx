import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { loadDraftManagementAction, saveDraftManagementAction, type DraftManagementActionResult } from "@/features/jobs/drafts/pipeline/management-actions";
import { notifyActionResult } from "@/components/feedback/notify";
import { ManagementEditor } from "./editor";
import { managementFixture } from "./test-fixture";
vi.mock("@/features/jobs/drafts/pipeline/management-actions", () => ({ loadDraftManagementAction: vi.fn(), saveDraftManagementAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
// Keep the real Calendar; Base UI popup focus restoration loops in jsdom.
vi.mock("@/components/ui/popover", () => {
  const Context = React.createContext<{ open: boolean; change: (value: boolean) => void }>({ open: false, change: () => {} });
  return {
    Popover: ({ open, onOpenChange, children }: { open: boolean; onOpenChange: (value: boolean) => void; children: React.ReactNode }) => <Context.Provider value={{ open, change: onOpenChange }}>{children}</Context.Provider>,
    PopoverTrigger: ({ render }: { render: React.ReactElement<{ onClick?: () => void }> }) => { const context = React.useContext(Context); return React.cloneElement(render, { onClick: () => context.change(true) }); },
    PopoverContent: ({ children }: { children: React.ReactNode }) => React.useContext(Context).open ? <div role="dialog">{children}</div> : null,
  };
});
const draftId = "123e4567-e89b-42d3-a456-426614174000";
const save = () => screen.getByRole("button", { name: "Guardar cambios" });
const headcount = () => screen.getByRole("textbox", { name: "Plazas a cubrir" });
const dateField = () => screen.getByRole("button", { name: "Fecha de solicitud" });
const edit = (value = "5") => fireEvent.change(headcount(), { target: { value } });
const success = (version = "1", quantity: number | null = 5): DraftManagementActionResult => ({ ok: true, management: { ...managementFixture(), version, hiringHeadcount: quantity }, etag: '"management-next"' });
function mount(management = managementFixture()) { return render(<ManagementEditor draftId={draftId} management={management} etag={'"management-0"'} />); }
beforeEach(() => { vi.resetAllMocks(); vi.mocked(saveDraftManagementAction).mockResolvedValue(success()); vi.mocked(loadDraftManagementAction).mockResolvedValue(success()); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("composes one Solicitud card, ordered icon Fields and a reserved status in the compact footer", () => {
  const { container } = mount(); expect(screen.getByRole("heading", { level: 3, name: "Solicitud" })).toBeVisible();
  expect(screen.getByText("Datos internos de la solicitud. Los candidatos nunca los ven. Hacen falta para publicar.")).toBeVisible();
  expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(1); expect(container.querySelectorAll('[data-slot="field"]')).toHaveLength(2);
  const labels = container.querySelectorAll('[data-slot="field-label"]'); expect([...labels].map(label => label.textContent)).toEqual(["Fecha de solicitud", "Plazas a cubrir"]);
  for (const label of labels) expect(label.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  expect(headcount()).toHaveAttribute("type", "text"); expect(headcount()).toHaveAttribute("inputmode", "numeric");
  expect(headcount()).toHaveAccessibleDescription("Cuántas personas hay que contratar (1 a 999). Es independiente del objetivo de entrega.");
  expect(dateField()).toHaveAccessibleDescription("Cuándo te pidieron cubrir esta vacante. Puede ser hoy o una fecha pasada.");
  const slot = container.querySelector('[data-pf-action-status-slot]')!; expect(slot).toBeEmptyDOMElement(); expect(save().compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const bar = slot.closest("[data-pf-action-bar]")!; expect(bar).not.toHaveClass("flex-col"); expect(bar).toHaveClass("items-start");
  expect(slot.closest('[data-slot="card-footer"]')).toContainElement(save()); expect(slot.closest('[data-slot="card-footer"]')).toHaveClass("border-t");
  expect(save()).toBeDisabled(); expect(screen.getByRole("button", { name: "Descartar cambios" })).toBeDisabled();
});
it("uses server today even when the browser differs, allows past weekends, disables future and caps navigation", async () => {
  vi.spyOn(Date, "now").mockReturnValue(new Date("2030-01-01T12:00:00Z").getTime());
  const user = userEvent.setup(); mount(); await user.click(dateField());
  const calendar = document.querySelector('[data-slot="calendar"]')!; expect(calendar).toHaveClass("[--cell-size:--spacing(10)]");
  const day = (value: string) => calendar.querySelector(`button[data-day="${value}"]`) as HTMLButtonElement;
  expect(day("15/10/2026")).toBeEnabled(); expect(day("11/10/2026")).toBeEnabled(); expect(day("16/10/2026")).toBeEnabled(); expect(day("17/10/2026")).toBeDisabled();
  expect(day("16/10/2026").closest("td")).toHaveClass("rdp-today");
  expect(calendar.querySelector(".rdp-button_next")).toHaveAttribute("aria-disabled", "true");
  await user.click(day("16/10/2026")); expect(dateField()).toHaveTextContent("16 de octubre de 2026"); fireEvent.click(save());
  await waitFor(() => expect(saveDraftManagementAction).toHaveBeenCalledExactlyOnceWith({ draftId, ifMatch: '"management-0"', body: { requestDate: "2026-10-16", hiringHeadcount: null } }));
});
it("displays a stored future date, but opens at the server's month", async () => {
  mount({ ...managementFixture(), requestDate: "2028-01-01" }); expect(dateField()).toHaveTextContent("1 de enero de 2028");
  fireEvent.click(dateField()); expect(document.querySelector('[data-slot="calendar"] .rdp-caption_label')).toHaveTextContent("octubre 2026");
  edit(); fireEvent.click(save()); await waitFor(() => expect(saveDraftManagementAction).toHaveBeenCalledWith(expect.objectContaining({ body: { requestDate: "2028-01-01", hiringHeadcount: 5 } })));
});
it("can clear a date and discard raw edits", async () => {
  mount({ ...managementFixture(), requestDate: "2026-10-10" }); fireEvent.click(screen.getByRole("button", { name: "Quitar fecha" })); edit("abc");
  fireEvent.click(screen.getByRole("button", { name: "Descartar cambios" })); expect(headcount()).toHaveValue(""); expect(dateField()).toHaveTextContent("10 de octubre de 2026"); expect(save()).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Quitar fecha" })); fireEvent.click(save()); await waitFor(() => expect(saveDraftManagementAction).toHaveBeenCalledWith(expect.objectContaining({ body: { requestDate: null, hiringHeadcount: null } })));
});
it.each([["abc", "Escribe un número entero."], ["1.5", "Escribe un número entero."], ["0", "Usa un número entre 1 y 999."], ["1000", "Usa un número entre 1 y 999."]])("validates raw %s inline and focuses the invalid field", (value, message) => {
  mount(); edit(value); fireEvent.blur(headcount()); expect(screen.getByText(message)).toHaveAttribute("data-slot", "field-error"); expect(headcount()).toHaveAttribute("aria-invalid", "true"); expect(headcount()).toHaveAccessibleDescription(expect.stringContaining(message)); fireEvent.click(save()); expect(saveDraftManagementAction).not.toHaveBeenCalled(); expect(headcount()).toHaveFocus();
});
it("uses the server's headcount limit in help and validation", () => {
  mount({ ...managementFixture(), limits: { maxHiringHeadcount: 2 } }); edit("3"); fireEvent.click(save()); expect(screen.getByText("Usa un número entre 1 y 2.")).toBeVisible(); expect(headcount()).toHaveAccessibleDescription(expect.stringContaining("(1 a 2)"));
});
it("sends exact body with ETag, adopts next ETag and never marks subsequent edits saved", async () => {
  mount(); edit(); fireEvent.click(save()); await screen.findByText("Guardado"); expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ key: "management-save", type: "success", title: "Solicitud guardada" })); expect(save()).toBeDisabled();
  edit("6"); expect(screen.getByRole("status")).toHaveTextContent("Cambios sin guardar"); fireEvent.click(save()); await waitFor(() => expect(saveDraftManagementAction).toHaveBeenCalledTimes(2)); expect(vi.mocked(saveDraftManagementAction).mock.calls[1][0]).toEqual({ draftId, ifMatch: '"management-next"', body: { requestDate: null, hiringHeadcount: 6 } });
});
it("emits info on a server no-op", async () => { vi.mocked(saveDraftManagementAction).mockResolvedValue(success("0")); mount(); edit(); fireEvent.click(save()); await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "info", title: "No había cambios que guardar" }))); });
it("keeps conflicting edits until an explicit version reload", async () => {
  vi.mocked(saveDraftManagementAction).mockResolvedValue({ ok: false, reason: "version_conflict", reference: { status: 412, code: "version_conflict" } }); vi.mocked(loadDraftManagementAction).mockResolvedValue(success("2", 7));
  mount(); edit(); fireEvent.click(save()); const reload = await screen.findByRole("button", { name: "Cargar versión actual" }); expect(headcount()).toHaveValue("5"); expect(loadDraftManagementAction).not.toHaveBeenCalled(); fireEvent.click(reload); await waitFor(() => expect(headcount()).toHaveValue("7")); expect(save()).toBeDisabled();
});
it.each(["saved", "not_saved", "conflict"] as const)("reconciles uncertain %s without replaying PUT", async outcome => {
  vi.mocked(saveDraftManagementAction).mockResolvedValue({ ok: false, reason: "no_response", reference: {} }); vi.mocked(loadDraftManagementAction).mockResolvedValue(outcome === "saved" ? success() : outcome === "not_saved" ? success("0", null) : success("2", 7));
  mount(); edit(); fireEvent.click(save()); const check = await screen.findByRole("button", { name: "Comprobar" }); expect(headcount()).toHaveValue("5"); expect(loadDraftManagementAction).not.toHaveBeenCalled(); fireEvent.click(check);
  if (outcome === "saved") await waitFor(() => expect(save()).toBeDisabled());
  else if (outcome === "not_saved") { await screen.findByText("No se guardó. Puedes guardar de nuevo; es seguro."); expect(headcount()).toHaveValue("5"); }
  else { await screen.findByRole("button", { name: "Cargar versión actual" }); expect(headcount()).toHaveValue("5"); }
  expect(saveDraftManagementAction).toHaveBeenCalledTimes(1);
});
it("retains edits and recovery if reconciliation GET fails", async () => {
  vi.mocked(saveDraftManagementAction).mockResolvedValue({ ok: false, reason: "server_error", reference: { status: 500 } }); vi.mocked(loadDraftManagementAction).mockRejectedValue(new Error("unsafe")); mount(); edit(); fireEvent.click(save()); fireEvent.click(await screen.findByRole("button", { name: "Comprobar" })); await waitFor(() => expect(loadDraftManagementAction).toHaveBeenCalledTimes(1)); expect(headcount()).toHaveValue("5"); expect(screen.getByRole("button", { name: "Comprobar" })).toBeEnabled();
});
it("keeps valid edits when server validation rejects them and includes a safe reference", async () => {
  vi.mocked(saveDraftManagementAction).mockResolvedValue({ ok: false, reason: "validation_error", reference: { status: 400, code: "validation_error" } }); mount(); edit(); fireEvent.click(save()); await screen.findByText("No se guardó · revisa los datos"); expect(headcount()).toHaveValue("5");
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", reference: { status: 400, code: "validation_error", at: expect.any(String) } }));
});
it("shows spinner, blocks duplicate writes and preserves pending form", async () => {
  let resolve!: (value: DraftManagementActionResult) => void; vi.mocked(saveDraftManagementAction).mockReturnValue(new Promise(yes => { resolve = yes; })); const { container } = mount(); edit(); fireEvent.click(save());
  const pending = screen.getByRole("button", { name: "Guardando…" }); expect(pending).toBeDisabled(); expect(container.querySelector('[data-slot="spinner"]')).not.toBeNull(); expect(headcount()).toBeDisabled(); expect(dateField()).toBeDisabled(); fireEvent.click(pending); await act(async () => resolve(success())); expect(saveDraftManagementAction).toHaveBeenCalledTimes(1);
});
it.each(["unauthenticated", "company_inactive"] as const)("offers real recovery link for %s", async reason => {
  vi.mocked(saveDraftManagementAction).mockResolvedValue({ ok: false, reason, reference: {} }); mount(); edit(); fireEvent.click(save()); const status = await screen.findByRole("status"); expect(within(status).getByRole("link")).toHaveAttribute("href", reason === "unauthenticated" ? "/empresa/login" : "/empresa/configuracion");
});
it("makes the toast shortcut follow the status link", async () => {
  vi.mocked(saveDraftManagementAction).mockResolvedValue({ ok: false, reason: "unauthenticated", reference: {} }); const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  mount(); edit(); fireEvent.click(save()); await screen.findByRole("status"); vi.mocked(notifyActionResult).mock.calls.at(-1)![0].action!.onClick(); expect(click).toHaveBeenCalledTimes(1); expect(click.mock.contexts[0]).toHaveAttribute("href", "/empresa/login");
});

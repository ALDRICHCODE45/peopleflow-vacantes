import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { loadDraftDeliveryAction, saveDraftDeliveryAction, type DraftDeliveryActionResult } from "@/features/jobs/drafts/pipeline/delivery-actions";
import { notifyActionResult } from "@/components/feedback/notify";
import { DeliveryEditor } from "./editor";
import { deliveryFixture } from "./test-fixture";
import { pipelineFixture } from "../stage-config/test-fixture";
vi.mock("@/features/jobs/drafts/pipeline/delivery-actions", () => ({ loadDraftDeliveryAction: vi.fn(), saveDraftDeliveryAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
// Base UI portal focus restoration loops in jsdom (same boundary as the installed
// DatePickerField tests). Keep the real Calendar, replace only popup boundaries.
vi.mock("@/components/ui/popover", () => {
  const Context = React.createContext<{ open: boolean; change: (value: boolean) => void }>({ open: false, change: () => {} });
  return {
    Popover: ({ open, onOpenChange, children }: { open: boolean; onOpenChange: (value: boolean) => void; children: React.ReactNode }) => <Context.Provider value={{ open, change: onOpenChange }}>{children}</Context.Provider>,
    PopoverTrigger: ({ render }: { render: React.ReactElement<{ onClick?: () => void }> }) => { const context = React.useContext(Context); return React.cloneElement(render, { onClick: () => context.change(true) }); },
    PopoverContent: ({ children }: { children: React.ReactNode }) => React.useContext(Context).open ? <div role="dialog">{children}</div> : null,
  };
});
vi.mock("@/components/ui/select", () => {
  type Value = { value: string; items: { value: string; label: string }[]; change: (value: string) => void };
  const Context = React.createContext<Value>({ value: "", items: [], change: () => {} });
  return {
    Select: ({ value, items, onValueChange, children }: Value & { onValueChange: Value["change"]; children: React.ReactNode }) => <Context.Provider value={{ value, items, change: onValueChange }}>{children}</Context.Provider>,
    SelectTrigger: ({ children, ...props }: React.ComponentProps<"button">) => <button role="combobox" aria-expanded="true" aria-controls="cutoff-options-probe" {...props}>{children}</button>,
    SelectValue: () => { const context = React.useContext(Context); return context.items.find(item => item.value === context.value)?.label; },
    SelectContent: ({ children }: { children: React.ReactNode }) => <div role="listbox" id="cutoff-options-probe">{children}</div>,
    SelectGroup: ({ children }: { children: React.ReactNode }) => <div role="group">{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => { const context = React.useContext(Context); return <button role="option" aria-selected={context.value === value} onClick={() => context.change(value)}>{children}</button>; },
  };
});
const draftId = "123e4567-e89b-42d3-a456-426614174000";
const save = () => screen.getByRole("button", { name: "Guardar cambios" });
const target = () => screen.getByRole("textbox", { name: "Objetivo de entrega" });
const edit = (value = "5") => fireEvent.change(target(), { target: { value } });
const success = (version = "1", quantity: number | null = 5): DraftDeliveryActionResult => ({ ok: true, delivery: { ...deliveryFixture(), version, targetQuantity: quantity }, etag: '"delivery-next"' });
function mount(delivery = deliveryFixture()) { return render(<DeliveryEditor draftId={draftId} delivery={delivery} etag={'"delivery-0"'} stages={pipelineFixture().stages} />); }
beforeEach(() => { vi.resetAllMocks(); vi.mocked(saveDraftDeliveryAction).mockResolvedValue(success()); vi.mocked(loadDraftDeliveryAction).mockResolvedValue(success()); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("composes one Entrega card, three icon Fields and an empty status slot below actions", () => {
  const { container } = mount(); expect(screen.getByRole("heading", { level: 3, name: "Entrega" })).toBeVisible();
  expect(screen.getByText("Define qué cuenta como entrega de esta vacante y para cuándo te comprometes. Puedes guardar los datos por partes; para publicar harán falta los tres.")).toBeVisible();
  expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(1); expect(container.querySelectorAll('[data-slot="field"]')).toHaveLength(3);
  for (const label of container.querySelectorAll('[data-slot="field-label"]')) expect(label.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  expect(target()).toHaveAttribute("type", "text"); expect(target()).toHaveAttribute("inputmode", "numeric"); expect(target()).toHaveAccessibleDescription("Cuántos candidatos distintos tienes que entregar (1 a 999).");
  const slot = container.querySelector('[data-pf-action-status-slot]')!; expect(slot).toBeEmptyDOMElement(); expect(save().compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // Compact action footer (rules §12): one ActionBar row inside the CardFooter.
  expect(slot.closest("[data-pf-action-bar]")).not.toBeNull();
  expect(slot.closest('[data-slot="card-footer"]')).toContainElement(save());
  expect(save()).toBeDisabled(); expect(screen.getByRole("button", { name: "Descartar cambios" })).toBeDisabled();
});
it("offers Sin definir plus current progression names in order, excluding the exit", async () => {
  const user = userEvent.setup(); const stages = pipelineFixture().stages.map((stage, index) => ({ ...stage, name: `Actual ${index}` }));
  render(<DeliveryEditor draftId={draftId} delivery={deliveryFixture()} etag='"delivery"' stages={stages} />);
  const select = screen.getByRole("combobox", { name: "Columna de corte" }); expect(select).toHaveTextContent("Sin definir"); await user.click(select);
  const options = await screen.findAllByRole("option"); expect(options.map(option => option.textContent)).toEqual(["Sin definir", ...stages.map(stage => stage.name)]);
  await user.click(options[2]); expect(select).toHaveTextContent("Actual 1"); fireEvent.click(save());
  await waitFor(() => expect(saveDraftDeliveryAction).toHaveBeenCalledWith({ draftId, ifMatch: '"delivery"', body: { cutoffStageId: stages[1].id, targetQuantity: null, commitmentDate: null } }));
});
it("uses the server calendar, Spanish dates, window bounds and disabled business days", async () => {
  const user = userEvent.setup(); mount(); await user.click(screen.getByRole("button", { name: "Fecha compromiso" }));
  const calendar = document.querySelector('[data-slot="calendar"]')!; expect(calendar).not.toBeNull();
  expect(calendar).toHaveClass("[--cell-size:--spacing(10)]");
  const day = (date: string) => calendar.querySelector(`button[data-day="${date}"]`) as HTMLButtonElement;
  expect(day("15/10/2026")).toBeDisabled(); expect(day("17/10/2026")).toBeDisabled(); expect(day("18/10/2026")).toBeDisabled(); expect(day("16/10/2026")).toBeEnabled();
  await user.click(day("16/10/2026")); expect(screen.getByRole("button", { name: "Fecha compromiso" })).toHaveTextContent("16 de octubre de 2026");
  fireEvent.click(save()); await waitFor(() => expect(saveDraftDeliveryAction).toHaveBeenCalledWith(expect.objectContaining({ body: { cutoffStageId: null, targetQuantity: null, commitmentDate: "2026-10-16" } })));
});
it("respects both inclusive server boundaries even when the browser's date differs", async () => {
  const user = userEvent.setup();
  const delivery = deliveryFixture(); delivery.calendar.maxDate = "2026-10-20";
  mount(delivery); await user.click(screen.getByRole("button", { name: "Fecha compromiso" }));
  const calendar = document.querySelector('[data-slot="calendar"]')!;
  const day = (date: string) => calendar.querySelector(`button[data-day="${date}"]`) as HTMLButtonElement;
  expect(day("15/10/2026")).toBeDisabled(); expect(day("16/10/2026")).toBeEnabled();
  expect(day("20/10/2026")).toBeEnabled(); expect(day("21/10/2026")).toBeDisabled();
  expect(day("16/10/2026").closest("td")).toHaveClass("rdp-today");
  await user.click(day("20/10/2026")); fireEvent.click(save());
  await waitFor(() => expect(saveDraftDeliveryAction).toHaveBeenCalledWith(expect.objectContaining({ body: { cutoffStageId: null, targetQuantity: null, commitmentDate: "2026-10-20" } })));
});
it("can clear a stored date and discard raw edits", () => {
  mount({ ...deliveryFixture(), commitmentDate: "2026-10-16" }); fireEvent.click(screen.getByRole("button", { name: "Quitar fecha" })); edit("abc");
  fireEvent.click(screen.getByRole("button", { name: "Descartar cambios" })); expect(target()).toHaveValue(""); expect(screen.getByRole("button", { name: "Fecha compromiso" })).toHaveTextContent("16 de octubre de 2026"); expect(save()).toBeDisabled();
});
it.each([["abc", "Escribe un número entero."], ["1.5", "Escribe un número entero."], ["0", "Usa un número entre 1 y 999."], ["1000", "Usa un número entre 1 y 999."]])("validates raw %s inline", (value, message) => {
  mount(); edit(value); fireEvent.blur(target()); expect(screen.getByText(message)).toHaveAttribute("data-slot", "field-error"); expect(target()).toHaveAttribute("aria-invalid", "true"); expect(target()).toHaveAccessibleDescription(expect.stringContaining(message)); fireEvent.click(save()); expect(saveDraftDeliveryAction).not.toHaveBeenCalled();
});
it("paints the stale-date warning with the semantic warning tone, not muted text (rules §10.5)", () => {
  mount({ ...deliveryFixture(), commitmentDate: "2025-01-01" });
  const warning = screen.getByText("La fecha compromiso ya pasó; elige otra antes de publicar.");
  expect(warning).toHaveClass("text-status-review");
  expect(warning).not.toHaveClass("text-muted-foreground");
});
it("focuses the first invalid field on a rejected save, not always the target", () => {
  mount({ ...deliveryFixture(), cutoffStageId: "00000000-0000-4000-8000-0000000000aa" }); edit(); fireEvent.click(save());
  expect(saveDraftDeliveryAction).not.toHaveBeenCalled();
  expect(screen.getByRole("combobox", { name: "Columna de corte" })).toHaveFocus();
});
it("warns on an unchanged stale date but sends it unchanged while saving other fields", async () => {
  mount({ ...deliveryFixture(), commitmentDate: "2025-01-01" }); expect(screen.getByText("La fecha compromiso ya pasó; elige otra antes de publicar.")).toBeVisible(); edit(); fireEvent.click(save());
  await waitFor(() => expect(saveDraftDeliveryAction).toHaveBeenCalledExactlyOnceWith({ draftId, ifMatch: '"delivery-0"', body: { cutoffStageId: null, targetQuantity: 5, commitmentDate: "2025-01-01" } }));
});
it("sends exact body with ETag, adopts new ETag and never marks subsequent edits saved", async () => {
  mount(); edit(); fireEvent.click(save()); await screen.findByText("Guardado"); expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ key: "delivery-save", type: "success", title: "Entrega guardada" })); expect(save()).toBeDisabled();
  edit("6"); expect(screen.getByRole("status")).toHaveTextContent("Cambios sin guardar"); fireEvent.click(save()); await waitFor(() => expect(saveDraftDeliveryAction).toHaveBeenCalledTimes(2)); expect(vi.mocked(saveDraftDeliveryAction).mock.calls[1][0].ifMatch).toBe('"delivery-next"');
});
it("emits info on a server no-op", async () => { vi.mocked(saveDraftDeliveryAction).mockResolvedValue(success("0")); mount(); edit(); fireEvent.click(save()); await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "info", title: "No había cambios que guardar" }))); });
it("keeps conflicting edits until an explicit version reload", async () => {
  vi.mocked(saveDraftDeliveryAction).mockResolvedValue({ ok: false, reason: "version_conflict", reference: { status: 412, code: "version_conflict" } }); vi.mocked(loadDraftDeliveryAction).mockResolvedValue(success("2", 7));
  mount(); edit(); fireEvent.click(save()); const reload = await screen.findByRole("button", { name: "Cargar versión actual" }); expect(target()).toHaveValue("5"); expect(loadDraftDeliveryAction).not.toHaveBeenCalled(); fireEvent.click(reload); await waitFor(() => expect(target()).toHaveValue("7")); expect(save()).toBeDisabled();
});
it.each(["saved", "not_saved", "conflict"] as const)("reconciles uncertain %s without replaying PUT", async outcome => {
  vi.mocked(saveDraftDeliveryAction).mockResolvedValue({ ok: false, reason: "no_response", reference: {} }); vi.mocked(loadDraftDeliveryAction).mockResolvedValue(outcome === "saved" ? success() : outcome === "not_saved" ? success("0", null) : success("2", 7));
  mount(); edit(); fireEvent.click(save()); const check = await screen.findByRole("button", { name: "Comprobar" }); expect(target()).toHaveValue("5"); expect(loadDraftDeliveryAction).not.toHaveBeenCalled(); fireEvent.click(check);
  if (outcome === "saved") await waitFor(() => expect(save()).toBeDisabled());
  else if (outcome === "not_saved") { await screen.findByText("No se guardó. Puedes guardar de nuevo; es seguro."); expect(target()).toHaveValue("5"); }
  else { await screen.findByRole("button", { name: "Cargar versión actual" }); expect(target()).toHaveValue("5"); }
  expect(saveDraftDeliveryAction).toHaveBeenCalledTimes(1);
});
it("retains edits and recovery if the reconciliation GET fails", async () => {
  vi.mocked(saveDraftDeliveryAction).mockResolvedValue({ ok: false, reason: "server_error", reference: { status: 500 } }); vi.mocked(loadDraftDeliveryAction).mockRejectedValue(new Error("unsafe")); mount(); edit(); fireEvent.click(save()); fireEvent.click(await screen.findByRole("button", { name: "Comprobar" })); await waitFor(() => expect(loadDraftDeliveryAction).toHaveBeenCalledTimes(1)); expect(target()).toHaveValue("5"); expect(screen.getByRole("button", { name: "Comprobar" })).toBeEnabled();
});
it("maps non_business_date to an associated date FieldError without losing edits", async () => {
  vi.mocked(saveDraftDeliveryAction).mockResolvedValue({ ok: false, reason: "non_business_date", reference: { status: 400, code: "non_business_date" } }); mount(); edit(); fireEvent.click(save());
  expect(await screen.findByText("Ese día no es hábil. Elige otro.")).toHaveAttribute("data-slot", "field-error"); const date = screen.getByRole("button", { name: "Fecha compromiso" }); expect(date).toHaveAttribute("aria-invalid", "true"); expect(date).toHaveAccessibleDescription(expect.stringContaining("Ese día no es hábil.")); expect(target()).toHaveValue("5");
});
it("shows spinner, blocks duplicate writes and preserves the form during pending saves", async () => {
  let resolve!: (value: DraftDeliveryActionResult) => void; vi.mocked(saveDraftDeliveryAction).mockReturnValue(new Promise(yes => { resolve = yes; })); const { container } = mount(); edit(); fireEvent.click(save());
  const pending = screen.getByRole("button", { name: "Guardando…" }); expect(pending).toBeDisabled(); expect(container.querySelector('[data-slot="spinner"]')).not.toBeNull(); expect(target()).toBeDisabled(); fireEvent.click(pending); await act(async () => resolve(success())); expect(saveDraftDeliveryAction).toHaveBeenCalledTimes(1);
});
it("makes the toast shortcut follow the status line's real link instead of opening a URL itself", async () => {
  vi.mocked(saveDraftDeliveryAction).mockResolvedValue({ ok: false, reason: "unauthenticated", reference: {} });
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  mount(); edit(); fireEvent.click(save()); await screen.findByRole("status");
  const call = vi.mocked(notifyActionResult).mock.calls.at(-1)![0];
  call.action!.onClick();
  expect(open).not.toHaveBeenCalled();
  expect(click).toHaveBeenCalledTimes(1);
  expect(click.mock.contexts[0]).toHaveAttribute("href", "/empresa/login");
});
it.each(["unauthenticated", "company_inactive"] as const)("offers a real recovery link for %s", async reason => {
  vi.mocked(saveDraftDeliveryAction).mockResolvedValue({ ok: false, reason, reference: {} }); mount(); edit(); fireEvent.click(save()); const status = await screen.findByRole("status"); expect(within(status).getByRole("link")).toHaveAttribute("href", reason === "unauthenticated" ? "/empresa/login" : "/empresa/configuracion");
});

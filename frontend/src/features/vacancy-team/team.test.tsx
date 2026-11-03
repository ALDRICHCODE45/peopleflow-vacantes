import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ComponentProps, ReactNode } from "react";
import { TeamView } from "./team-view";
import { ReassignDialog } from "./reassign-dialog";
import { DeadlineDialog } from "./deadline-dialog";
import { createFixtureClient } from "./prototype-client";
import { TeamSkeleton } from "./loading";
import { notifyActionResult } from "@/components/feedback/notify";
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
// Same boundary as pipeline-movement/board.test.tsx: Select portal focus restoration
// loops in jsdom. Keep its controlled values; real portal interaction requires browser QA.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  type Value = { value: string; items: readonly { value: string; label: string }[]; change: (value: string) => void };
  const Context = React.createContext<Value>({ value: "", items: [], change: () => {} });
  return {
    Select: ({ value, items, onValueChange, children }: Omit<Value, "change"> & { onValueChange: Value["change"]; children: ReactNode }) => <Context.Provider value={{ value, items, change: onValueChange }}>{children}</Context.Provider>,
    SelectTrigger: ({ children, ...props }: ComponentProps<"button">) => <button role="combobox" aria-expanded="true" aria-controls="reason-options" {...props}>{children}</button>,
    SelectValue: () => { const context = React.useContext(Context); return context.items.find(item => item.value === context.value)?.label; },
    SelectContent: ({ children }: { children: ReactNode }) => <div role="listbox" id="reason-options">{children}</div>,
    SelectGroup: ({ children }: { children: ReactNode }) => <div role="group">{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => { const context = React.useContext(Context); return <button role="option" aria-selected={context.value === value} onClick={() => context.change(value)}>{children}</button>; },
  };
});
afterEach(cleanup);

it("shows owner capabilities and preserves mode → team → history order", async () => {
  const { container } = render(<TeamView client={createFixtureClient("owner")} />);
  expect(await screen.findByRole("button", { name: "Reasignar responsable" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Cambiar modo" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Agregar al equipo" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Salir de la vacante" })).not.toBeInTheDocument();
  expect(container.querySelectorAll('[data-slot="avatar-fallback"]')).toHaveLength(2);
  expect(screen.getAllByRole("heading", { level: 3 }).slice(0, 3).map(element => element.textContent)).toEqual(["Modo del equipo", "Equipo actual", "Movimientos del equipo"]);
  expect(screen.getByRole("button", { name: "Acciones de Ana López" })).toHaveAttribute("aria-haspopup", "menu");
  expect(screen.getByText("Plazo 20 nov 2026 · propio")).toBeVisible();
  expect(screen.getByText("Plazo 30 nov 2026 · fecha compromiso")).toBeVisible();
  expect(screen.queryByText(/^Desde /)).not.toBeInTheDocument();
});
it("collaborator only sees fixture can actions; changing is_owner never grants permissions", async () => {
  const client = createFixtureClient("collaborator");
  const team = await client.getTeam(); team.viewer.is_owner = true;
  render(<TeamView client={{ ...client, getTeam: async () => team }} />);
  expect(await screen.findByRole("button", { name: "Salir de la vacante" })).toBeVisible();
  for (const name of ["Agregar al equipo", "Cambiar modo", "Reasignar responsable", "Acciones de Ana López"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
});
it("renders an actionable empty history", async () => {
  render(<TeamView client={createFixtureClient("empty-history")} />);
  expect(await screen.findByRole("heading", { name: "Aún no hay cambios en el equipo" })).toBeVisible();
});
it("skeleton preserves the owner card composition slots", async () => {
  const slots = (container: HTMLElement) => Array.from(container.querySelectorAll('[data-slot]')).map(element => element.getAttribute("data-slot")).filter(slot => /^card(?:-|$)/.test(slot ?? ""));
  const skeleton = render(<TeamSkeleton />);
  const expected = slots(skeleton.container);
  skeleton.unmount();
  const view = render(<TeamView client={createFixtureClient("owner")} />);
  await screen.findByRole("heading", { name: "Equipo actual" });
  // The approved loading state stays unchanged; the mode and current-team cards retain their anatomy.
  expect(slots(view.container).slice(0, 14)).toEqual(expected.slice(0, 14));
});
it("refreshes paginated history from page one after its own write and reports an in-memory result", async () => {
  const client = createFixtureClient("long-history");
  const getHistory = vi.spyOn(client, "getHistory");
  render(<TeamView client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: "Ver todos los movimientos" }));
  fireEvent.click(await screen.findByRole("button", { name: "Ver más" }));
  await waitFor(() => expect(getHistory).toHaveBeenLastCalledWith("page:20"));
  fireEvent.click(screen.getByRole("button", { name: "Cerrar movimientos" }));
  fireEvent.click(await screen.findByRole("button", { name: "Cambiar modo" }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Cambiar modo" }));
  await waitFor(() => expect(getHistory).toHaveBeenLastCalledWith());
  expect(await screen.findByRole("button", { name: "Ver todos los movimientos" })).toBeVisible();
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "info", title: "Modo del equipo cambiado" }));
});
it("reassign composition, safe focus, default departure, Otro note and cancel without writes", async () => {
  const client = createFixtureClient("owner");
  const onConfirm = vi.fn(); const onClose = vi.fn();
  render(<ReassignDialog team={await client.getTeam()} company={await client.getCompanyMembers()} calendar={client.calendar} snapshot={client.snapshot} onConfirm={onConfirm} onClose={onClose} />);
  const dialog = await screen.findByRole("alertdialog");
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancelar" })).toHaveFocus());
  const header = dialog.querySelector('[data-slot="alert-dialog-header"]')!;
  expect(Array.from(header.children).map(child => child.getAttribute("data-slot"))).toEqual(["alert-dialog-media", "alert-dialog-title", "alert-dialog-description"]);
  expect(dialog.querySelectorAll('[data-slot="confirm-action-details"]')).toHaveLength(1);
  expect(dialog.querySelector('[data-slot="confirm-action-details"] [data-slot="field-group"]')).not.toBeNull();
  expect(dialog.querySelector('[data-slot="alert-dialog-footer"] [data-slot="alert-dialog-cancel"]')).not.toBeNull();
  expect(within(dialog).getByRole("button", { name: "Sale de la vacante" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(within(dialog).getByRole("option", { name: "Otro" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Reasignar" }));
  expect(await within(dialog).findByText("Escribe una nota para Otro.")).toBeVisible();
  expect(within(dialog).getByLabelText("Nota")).toHaveAttribute("aria-invalid", "true");
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
  expect(onClose).toHaveBeenCalled(); expect(onConfirm).not.toHaveBeenCalled();
});
it("reassign offers an optional recruiter deadline that falls back to the commitment date", async () => {
  const client = createFixtureClient("owner");
  render(<ReassignDialog team={await client.getTeam()} company={await client.getCompanyMembers()} calendar={client.calendar} snapshot={client.snapshot} onConfirm={vi.fn()} onClose={vi.fn()} />);
  const dialog = await screen.findByRole("alertdialog");
  expect(within(dialog).getByText("Hoy: 3 de 5 candidatos entregados · 7 de 12 días hábiles usados. Esto queda guardado con la reasignación.")).toBeVisible();
  expect(within(dialog).queryByRole("progressbar")).not.toBeInTheDocument();
  expect(within(dialog).queryByText("Estado guardado al reasignar")).not.toBeInTheDocument();
  const trigger = within(dialog).getByRole("button", { name: "Plazo del reclutador" });
  expect(trigger).toHaveAttribute("id", "reassign-deadline");
  expect(trigger).toHaveTextContent("Elige una fecha");
  expect(document.getElementById("reassign-deadline-description")).toHaveTextContent("Si no lo defines, aplica la fecha compromiso: 30 de noviembre de 2026.");
});
// Opens DeadlineDialog directly: DropdownMenu interaction loops in jsdom (same boundary as Select above); the menu path needs browser QA.
it("deadline editing opens the recruiter deadline field with the clear option", async () => {
  const client = createFixtureClient("owner");
  const member = (await client.getTeam()).members[0];
  const onConfirm = vi.fn();
  render(<DeadlineDialog member={member} calendar={client.calendar} commitmentDate={client.snapshot.delivery.commitment_date} pending={false} onConfirm={onConfirm} onClose={vi.fn()} />);
  const dialog = await screen.findByRole("alertdialog");
  expect(within(dialog).getByRole("heading", { name: "Plazo de Ana López" })).toBeVisible();
  expect(within(dialog).getByRole("button", { name: "Plazo del reclutador" })).toHaveAttribute("id", "member-deadline");
  expect(within(dialog).getByRole("button", { name: "Plazo del reclutador" })).toHaveTextContent("20 de noviembre de 2026");
  fireEvent.click(within(dialog).getByRole("button", { name: "Usar la fecha compromiso" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Guardar plazo" }));
  expect(onConfirm).toHaveBeenCalledWith(null);
});

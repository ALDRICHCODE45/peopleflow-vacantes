import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ConfirmActionDialog } from "./confirm-action-dialog";

afterEach(cleanup);

function mount(props: Partial<Parameters<typeof ConfirmActionDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(<ConfirmActionDialog open onOpenChange={onOpenChange} onConfirm={onConfirm} title="¿Mover a Ana Pérez a Screening?" description="Pasa de Nuevos a Screening. El cambio queda en su historial." confirmLabel="Mover" {...props} />);
  return { onConfirm, onOpenChange };
}

it("is an alert dialog naming the action, its consequence and an explicit confirm button", () => {
  const { onConfirm } = mount();
  const dialog = screen.getByRole("alertdialog", { name: "¿Mover a Ana Pérez a Screening?" });
  expect(dialog).toHaveAccessibleDescription("Pasa de Nuevos a Screening. El cambio queda en su historial.");
  fireEvent.click(screen.getByRole("button", { name: "Mover" }));
  expect(onConfirm).toHaveBeenCalledOnce();
});

it("cancels without confirming and starts with focus on Cancelar, never on the action", () => {
  const { onConfirm, onOpenChange } = mount();
  const cancel = screen.getByRole("button", { name: "Cancelar" });
  expect(cancel).toHaveFocus();
  fireEvent.click(cancel);
  expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  expect(onConfirm).not.toHaveBeenCalled();
});

it("locks both buttons and shows progress while pending, so a double click cannot confirm twice", () => {
  const { onConfirm } = mount({ pending: true, pendingLabel: "Moviendo…" });
  const action = screen.getByRole("button", { name: "Moviendo…" });
  expect(action).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
  fireEvent.click(action);
  expect(onConfirm).not.toHaveBeenCalled();
});

it("uses the destructive tone for destructive actions and renders extra details", () => {
  mount({ tone: "destructive", confirmLabel: "Descartar candidato", children: <p>Motivo: No cumple requisitos</p> });
  expect(screen.getByRole("button", { name: "Descartar candidato" }).className).toContain("destructive");
  expect(screen.getByText("Motivo: No cumple requisitos")).toBeVisible();
});

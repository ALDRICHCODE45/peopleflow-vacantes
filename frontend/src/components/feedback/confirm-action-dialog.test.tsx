import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ArrowRightLeft } from "lucide-react";
import { ConfirmActionDialog } from "./confirm-action-dialog";

afterEach(cleanup);

function mount(props: Partial<Parameters<typeof ConfirmActionDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(<ConfirmActionDialog open onOpenChange={onOpenChange} onConfirm={onConfirm} icon={ArrowRightLeft} title="¿Mover a Ana Pérez a Screening?" description="Pasa de Nuevos a Screening. El cambio queda en su historial." confirmLabel="Mover" {...props} />);
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

it("can block only the confirm button (e.g. while the board reloads) and keep Cancelar usable", () => {
  const { onConfirm, onOpenChange } = mount({ confirmDisabled: true });
  const action = screen.getByRole("button", { name: "Mover" });
  expect(action).toBeDisabled();
  fireEvent.click(action);
  expect(onConfirm).not.toHaveBeenCalled();
  const cancel = screen.getByRole("button", { name: "Cancelar" });
  expect(cancel).toBeEnabled();
  fireEvent.click(cancel);
  expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
});

it("forwards the element that receives focus when the dialog closes", () => {
  const target = document.createElement("button");
  const finalFocus = { current: target };
  render(<ConfirmActionDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} icon={ArrowRightLeft} title="T" description="D" confirmLabel="Mover" finalFocus={finalFocus} />);
  expect(screen.getByRole("alertdialog")).toBeVisible();
});

it("follows the official shadcn composition: media, title and description in the header, then the footer", () => {
  mount();
  const dialog = screen.getByRole("alertdialog");
  const header = dialog.querySelector('[data-slot="alert-dialog-header"]')!;
  const media = header.querySelector('[data-slot="alert-dialog-media"]')!;
  expect(media.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  expect(media.nextElementSibling).toHaveAttribute("data-slot", "alert-dialog-title");
  expect(header.nextElementSibling).toHaveAttribute("data-slot", "alert-dialog-footer");
  // Official «Basic» example: default size, so real Spanish labels never get squeezed into the
  // two equal columns of size="sm" (user: «revisa el primer ejemplo para que veas como se hace»).
  expect(dialog).toHaveAttribute("data-size", "default");
});

it("uses the default size and a single details slot between header and footer when details exist", () => {
  mount({ tone: "destructive", children: <p>Motivo: No cumple requisitos</p> });
  const dialog = screen.getByRole("alertdialog");
  expect(dialog).toHaveAttribute("data-size", "default");
  const details = dialog.querySelector('[data-slot="confirm-action-details"]')!;
  expect(details.previousElementSibling).toHaveAttribute("data-slot", "alert-dialog-header");
  expect(details.nextElementSibling).toHaveAttribute("data-slot", "alert-dialog-footer");
  // Long details (discard form, candidate lists) scroll inside the dialog; header and footer stay visible.
  expect(details.className).toContain("overflow-y-auto");
  expect(details.className).toContain("max-h-");
  expect(dialog.querySelector('[data-slot="alert-dialog-media"]')!.className).toContain("text-destructive");
});

it("lets the cancel action carry the decision when «Cancelar» is not the right word", () => {
  const { onOpenChange, onConfirm } = mount({ cancelLabel: "Continuar editando", confirmLabel: "Salir de todos modos" });
  const keep = screen.getByRole("button", { name: "Continuar editando" });
  expect(keep).toHaveFocus();
  fireEvent.click(keep);
  expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  expect(onConfirm).not.toHaveBeenCalled();
});

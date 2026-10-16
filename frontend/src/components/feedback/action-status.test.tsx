import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Button } from "@/components/ui/button";
import { ActionStatus, ActionStatusSlot } from "./action-status";

afterEach(cleanup);
it.each(["success", "error", "warning", "info"] as const)("renders persistent %s status and decorative icon", tone => {
  const {container} = render(<ActionStatus id="result" tone={tone} text="Guardado · versión 2" />);
  expect(screen.getByRole("status")).toHaveAttribute("id", "result");
  expect(screen.getByRole("status")).toHaveTextContent("Guardado · versión 2");
  expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
});
it("retains a real action outside the toast", () => {
  render(<ActionStatus id="result" tone="error" text="No se guardó · ver aviso" action={<Button className="min-h-10">Reintentar</Button>} />);
  expect(screen.getByRole("button", {name:"Reintentar"})).toHaveClass("min-h-10");
});
it("reserves the status space even while empty, so results never move the action", () => {
  const {container, rerender} = render(<ActionStatusSlot />);
  const slot = container.querySelector("[data-pf-action-status-slot]");
  expect(slot).toBeInTheDocument();
  expect(slot).toHaveClass("min-h-10");
  expect(slot).toBeEmptyDOMElement();
  rerender(<ActionStatusSlot><ActionStatus id="result" tone="success" text="Guardado · versión 1" /></ActionStatusSlot>);
  expect(container.querySelector("[data-pf-action-status-slot]")).toHaveTextContent("Guardado · versión 1");
});
it("lays out a compact action bar: one row, actions first in the DOM, status reserved on the left", async () => {
  const { ActionBar } = await import("./action-status");
  const { container } = render(<ActionBar status={null}><Button>Guardar cambios</Button></ActionBar>);
  const bar = container.querySelector("[data-pf-action-bar]")!;
  expect(bar).toHaveClass("flex", "w-full", "items-start");
  const actions = bar.querySelector("[data-pf-action-bar-actions]")!;
  const slot = bar.querySelector("[data-pf-action-status-slot]")!;
  expect(actions).toContainElement(screen.getByRole("button", { name: "Guardar cambios" }));
  // DOM order: actions, then status (reading order); visual order: status left.
  expect(actions.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(slot.parentElement).toHaveClass("order-first", "min-w-0", "flex-1");
  expect(slot).toBeEmptyDOMElement();
});

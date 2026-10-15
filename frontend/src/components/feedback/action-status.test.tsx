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

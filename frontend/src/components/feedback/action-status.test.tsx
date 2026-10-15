import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Button } from "@/components/ui/button";
import { ActionStatus } from "./action-status";

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

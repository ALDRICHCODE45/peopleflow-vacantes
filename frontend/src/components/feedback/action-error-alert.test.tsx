import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Button } from "@/components/ui/button";
import { ActionErrorAlert } from "./action-error-alert";
afterEach(cleanup);
it("composes one alert with title, description, action and collapsed reference", () => {
  render(<ActionErrorAlert id="failure" title="El servidor tuvo un problema" description="Puedes reintentar." action={<Button className="min-h-10">Reintentar</Button>} reference={{ status: 500, code: "internal_error", at: "2026-10-06T17:58:46" }} />);
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(screen.getByRole("alert")).toHaveAttribute("id", "failure");
  expect(screen.getByText("El servidor tuvo un problema")).toBeVisible();
  expect(screen.getByText("Puedes reintentar.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Reintentar" })).toBeVisible();
  expect(screen.queryByText("HTTP 500 · internal_error · 17:58:46")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Detalles técnicos" }));
  expect(screen.getByText("HTTP 500 · internal_error · 17:58:46")).toBeVisible();
});
it("omits technical disclosure without a reference", () => {
  render(<ActionErrorAlert title="Error" description="Conserva tus cambios." />);
  expect(screen.queryByRole("button", { name: "Detalles técnicos" })).not.toBeInTheDocument();
});

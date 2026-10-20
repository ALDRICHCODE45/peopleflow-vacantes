import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import DetailError from "./[jobId]/error";
import ListingError from "./error";
import NotFound from "./[jobId]/not-found";
afterEach(cleanup);
it.each([[DetailError, "Ver vacantes", "/vacantes"], [ListingError, "Volver al inicio", "/"]] as const)("composes a recovery card without automatic retry: %s", (Component, label, href) => {
  const reset = vi.fn();
  const { container } = render(<Component error={new Error("private")} reset={reset} />);
  expect(container.querySelector('[data-slot="card"] [data-slot="empty-header"] [data-slot="empty-icon"]')).not.toBeNull();
  expect(screen.getByRole("alert")).toBeVisible();
  expect(screen.queryByText("private")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href);
  expect(reset).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  expect(reset).toHaveBeenCalledOnce();
});
it("offers other vacancies inside the not-found card", () => {
  render(<NotFound />);
  const heading = screen.getByRole("heading", { name: "Esta vacante no está disponible" });
  expect(heading.closest('[data-slot="card"]')).not.toBeNull();
  expect(screen.getByRole("link", { name: "Explorar vacantes" })).toHaveAttribute("href", "/vacantes");
  expect(screen.getByRole("link", { name: "Volver al inicio" })).toHaveAttribute("href", "/");
});

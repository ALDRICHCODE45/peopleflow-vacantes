import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
const reload = vi.hoisted(() => ({ reloadPage: vi.fn() }));
vi.mock("@/features/jobs/components/reload-page", () => reload);
import DetailError from "./[jobId]/error";
import ListingError from "./error";
import NotFound from "./[jobId]/not-found";
afterEach(cleanup);
it.each([[DetailError, "Ver vacantes", "/vacantes"], [ListingError, "Volver al inicio", "/"]] as const)("composes a recovery card whose retry reloads the page: %s", (Component, label, href) => {
  reload.reloadPage.mockClear();
  const reset = vi.fn();
  const { container } = render(<Component error={new Error("private")} reset={reset} />);
  expect(container.querySelector('[data-slot="card"] [data-slot="empty-header"] [data-slot="empty-icon"]')).not.toBeNull();
  expect(screen.getByRole("alert")).toBeVisible();
  expect(screen.queryByText("private")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href);
  expect(reset).not.toHaveBeenCalled();
  const retry = screen.getByRole("button", { name: "Reintentar" });
  fireEvent.click(retry);
  // reset() only re-renders on the client and never re-requests the server
  // data that failed; a new document always does.
  expect(reload.reloadPage).toHaveBeenCalledOnce();
  expect(reset).not.toHaveBeenCalled();
  expect(retry).toBeDisabled();
});
it("offers other vacancies inside the not-found card", () => {
  render(<NotFound />);
  const heading = screen.getByRole("heading", { name: "Esta vacante no está disponible" });
  expect(heading.closest('[data-slot="card"]')).not.toBeNull();
  expect(screen.getByRole("link", { name: "Explorar vacantes" })).toHaveAttribute("href", "/vacantes");
  expect(screen.getByRole("link", { name: "Volver al inicio" })).toHaveAttribute("href", "/");
});

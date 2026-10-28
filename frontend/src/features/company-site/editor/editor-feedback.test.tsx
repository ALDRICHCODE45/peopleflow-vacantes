import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SaveStatus } from "./editor-feedback";

it("announces an expired autosave session instead of a generic save error", () => {
  render(<SaveStatus status={{ kind: "error", failure: { kind: "unauthenticated" } }} dirty onLoadLatest={vi.fn()} />);
  expect(screen.getByRole("status").textContent).toBe("Tu sesión expiró. Inicia sesión para guardar los cambios.");
});

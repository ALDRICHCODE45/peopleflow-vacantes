import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { BoardError } from "./board-states";

afterEach(cleanup);
it("makes retry the primary recovery for a failed board read", () => {
  const retry = vi.fn();
  const { container } = render(<BoardError failure={{ ok: false, reason: "server_error", reference: {} }} reading={false} notice={null} retry={retry} />);
  const button = screen.getByRole("button", { name: "Reintentar" });
  expect(button).toHaveClass("bg-primary", "w-full", "sm:w-auto");
  expect(container.querySelector('[data-slot="empty-title"]')).toHaveClass("text-xl", "font-semibold");
  expect(container.querySelector('[data-slot="empty-header"]')).toHaveClass("max-w-md");
  expect(button.closest('[data-slot="card"]')).not.toBeNull();
  fireEvent.click(button);
  expect(retry).toHaveBeenCalledOnce();
});
it("prioritizes signing in when the session has expired, keeping retry secondary", () => {
  render(<BoardError failure={{ ok: false, reason: "unauthenticated", reference: {} }} reading={false} notice={null} retry={vi.fn()} />);
  expect(screen.getByRole("link", { name: "Iniciar sesión" })).toHaveClass("bg-primary");
  expect(screen.getByRole("button", { name: "Reintentar" })).not.toHaveClass("bg-primary");
});

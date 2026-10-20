import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CircleAlert } from "lucide-react";
import { StateCard } from "@/components/feedback/state-card";

afterEach(cleanup);

it("composes a centered Card with the official Empty anatomy and explicit recovery", () => {
  const retry = vi.fn();
  const { container } = render(<StateCard icon={CircleAlert} tone="error" title="No pudimos cargar tu cuenta" description="Tu cuenta no cambió." header={<span>Tu cuenta</span>} primaryAction={{ label: "Reintentar", onClick: retry }} secondaryAction={{ label: "Ir al inicio", href: "/" }} alternativeLink={{ label: "Ver ayuda", href: "/ayuda" }} />);
  const card = container.querySelector('[data-slot="card"]')!;
  expect(card).toHaveClass("mx-auto", "w-full");
  const header = card.querySelector('[data-slot="empty-header"]')!;
  expect(header.querySelector('[data-slot="empty-icon"]')).toHaveClass("bg-destructive/10");
  expect(header).toContainElement(screen.getByRole("heading", { name: "No pudimos cargar tu cuenta" }));
  expect(header.querySelector('[data-slot="empty-description"]')).toHaveTextContent("Tu cuenta no cambió.");
  const content = card.querySelector('[data-slot="empty-content"]')!;
  expect(content).toContainElement(screen.getByRole("button", { name: "Reintentar" }));
  expect(content).toContainElement(screen.getByRole("link", { name: "Ir al inicio" }));
  expect(screen.getByRole("link", { name: "Ir al inicio" })).toHaveClass("border-border", "bg-background");
  expect(screen.getByRole("link", { name: "Ver ayuda" })).toHaveClass("underline-offset-4");
  expect(retry).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it.each([["forbidden", "bg-destructive/10"], ["empty", "bg-muted"], ["info", "bg-primary/10"]] as const)("supports %s without inventing announcements or actions", (tone, color) => {
  const { container } = render(<StateCard icon={CircleAlert} tone={tone} title="Estado" description="Descripción" />);
  expect(container.querySelector('[data-slot="empty-icon"]')).toHaveClass(color);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("preserves opt-in announcements and disabled recovery", () => {
  const retry = vi.fn();
  render(<StateCard icon={CircleAlert} tone="error" role="alert" title="Error" description="Intenta nuevamente." primaryAction={{ label: "Reintentar", onClick: retry, disabled: true }} />);
  expect(screen.getByRole("alert")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  expect(retry).not.toHaveBeenCalled();
});

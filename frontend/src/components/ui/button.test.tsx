import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Button } from "./button";

afterEach(cleanup);

it("paints the link variant with the readable violet text token (dark --primary is a ~2:1 fill, not text)", () => {
  render(<Button variant="link">Conoce la empresa</Button>);
  const link = screen.getByRole("button", { name: "Conoce la empresa" });
  expect(link).toHaveClass("text-primary-text", "underline-offset-4", "hover:underline");
  expect(link).not.toHaveClass("text-primary");
});

it("keeps the default variant on the primary fill with its own foreground", () => {
  render(<Button>Guardar</Button>);
  expect(screen.getByRole("button", { name: "Guardar" })).toHaveClass("bg-primary", "text-primary-foreground");
});

import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ApplicationRow, appliedAgo, type Application } from "./inbox";
import { page } from "./test-fixtures";

afterEach(cleanup);
const title = "Químico(a) Farmacéutico(a) Responsable Sanitario de Planta Farmacéutica";
const item: Application = { ...page.items[0], vacancy: { ...page.items[0].vacancy, title } };
const now = Date.parse("2026-10-20T12:00:00Z");

it("wraps a long application title to two lines inside its row instead of overflowing at 390 px", () => {
  render(<ApplicationRow item={item} selected={false} onSelect={() => undefined} now={now} />);
  const link = screen.getByRole("link", { name: title });
  expect(link).toHaveClass("line-clamp-2", "break-words");
  expect(link).not.toHaveClass("truncate", "w-fit");
  // The text column can shrink below its content width, so the title wraps instead of widening the row.
  expect(link.parentElement).toHaveClass("min-w-0");
});

it("folds the status into the chips on compact screens, keeping one badge per row", () => {
  render(<ApplicationRow item={item} selected compact onSelect={() => undefined} now={now} />);
  const link = screen.getByRole("link", { name: title });
  const row = link.closest("[data-pf-application-row]")!;
  expect(row.querySelectorAll('[data-slot="badge"]')).toHaveLength(1);
  expect(link.parentElement).toContainElement(screen.getByText("Enviada"));
  // Compact rows open the full-screen detail: no selected tint or aria-current there.
  expect(link).toHaveAttribute("aria-haspopup", "dialog");
  expect(link).not.toHaveAttribute("aria-current");
  expect(row).not.toHaveClass("bg-primary/7");
});

it.each([
  ["2026-10-20T11:59:00Z", "hoy"],
  ["2026-10-19T12:30:00Z", "hoy"],
  ["2026-10-19T11:00:00Z", "hace 1 día"],
  ["2026-10-15T12:00:00Z", "hace 5 días"],
  ["2026-10-21T12:00:00Z", "hoy"],
])("reads an application from %s as «Postulada %s»", (appliedAt, expected) => {
  expect(appliedAgo(appliedAt, now)).toBe(expected);
});

import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ApplicationRow, type Application } from "./inbox";
import { page } from "./test-fixtures";

afterEach(cleanup);
const title = "Químico(a) Farmacéutico(a) Responsable Sanitario de Planta Farmacéutica";
const item: Application = { ...page.items[0], vacancy: { ...page.items[0].vacancy, title } };

it("wraps a long application title to two lines inside its card instead of overflowing at 390 px", () => {
  render(<ApplicationRow item={item} selected={false} onSelect={() => undefined} now={Date.parse("2026-10-20T12:00:00Z")} />);
  const heading = screen.getByRole("heading", { level: 3, name: title });
  // `truncate` (nowrap) made the title's min-content its full width, so `w-fit` grew past the card.
  expect(heading).toHaveClass("line-clamp-2", "break-words");
  expect(heading).not.toHaveClass("truncate");
  const slot = heading.closest('[data-slot="item-title"]');
  // The shared ItemTitle is `w-fit`; this usage takes the content column width instead.
  expect(slot).toHaveClass("w-full", "min-w-0");
  expect(slot).not.toHaveClass("w-fit");
  // Its one-line clamp would cut the inner two-line clamp; `line-clamp-none` makes the slot a plain block.
  expect(slot).toHaveClass("line-clamp-none");
  expect(slot).not.toHaveClass("line-clamp-1");
});

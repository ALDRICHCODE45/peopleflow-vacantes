import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
afterEach(cleanup);

it.each(["./loading", "./[jobId]/loading"])("renders a contextual accessible skeleton for %s", async (path) => {
  const Loading = (await import(/* @vite-ignore */ path)).default;
  const { container } = render(<Loading />);
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
  expect(skeletons.length).toBeGreaterThan(5);
  for (const skeleton of skeletons) expect(skeleton).toHaveAttribute("aria-hidden", "true");
});

it("mirrors the loaded list: search card, quick filters, filters card with header and results", async () => {
  const Loading = (await import("./loading")).default;
  const { container } = render(<Loading />);
  const cards = [...container.querySelectorAll('[data-slot="card"]')].filter(card => !card.closest('[data-skeleton-results]'));
  const slots = (card: Element) => [...card.querySelectorAll("[data-slot^='card-']")].filter(el => el.closest('[data-slot="card"]') === card).map(el => el.getAttribute("data-slot"));
  // Search card: content only, two labelled fields and the «Buscar» button.
  expect(slots(cards[0])).toEqual(["card-content"]);
  expect(cards[0].querySelectorAll("[data-skeleton-field]")).toHaveLength(2);
  expect(cards[0].querySelectorAll("[data-skeleton-button]")).toHaveLength(1);
  // Quick filters: four pills.
  expect(container.querySelectorAll("[data-skeleton-quick-filter]")).toHaveLength(4);
  // Filters card: header with title, four labelled selects and two buttons.
  expect(slots(cards[1])).toEqual(["card-header", "card-title", "card-content"]);
  expect(cards[1].querySelectorAll("[data-skeleton-field]")).toHaveLength(4);
  expect(cards[1].querySelectorAll("[data-skeleton-button]")).toHaveLength(2);
  const results = container.querySelectorAll('[data-skeleton-results] [data-slot="card"]');
  expect(results).toHaveLength(3);
  for (const card of results) {
    expect(card).toHaveClass("grid", "md:grid-cols-[minmax(0,1fr)_14rem]");
    expect(slots(card)).toEqual(["card-header", "card-title", "card-description", "card-action", "card-content", "card-footer"]);
    expect(card.querySelector('[data-slot="card-footer"]')).toHaveClass("md:border-l", "md:row-span-2");
    expect(card.querySelector('[data-slot="card-title"] [data-slot="skeleton"]')).toHaveClass("size-12");
    expect(card.querySelectorAll('[data-public-job-chips] [data-slot="skeleton"]')).toHaveLength(4);
  }
});

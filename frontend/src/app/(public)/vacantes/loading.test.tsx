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

import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CompanySitePresentation } from "./company-site-presentation";
import { publishedFixture } from "./fixtures.test-support";

vi.mock("next/font/google", () => ({ Fraunces: () => ({ variable: "editorial" }), Plus_Jakarta_Sans: () => ({ variable: "modern" }) }));
afterEach(cleanup);

it("offers the share menu in the live careers header but not in the editor preview", () => {
  const data = publishedFixture();
  const props = { site: data.site, company: data.company, jobs: [], officeLabels: new Map<string, string>() };
  const live = render(<CompanySitePresentation {...props} />);
  expect(screen.getByRole("button", { name: "Compartir sitio de empleo" })).toHaveAttribute("aria-haspopup", "menu");
  live.unmount();
  render(<CompanySitePresentation {...props} onSelectBlock={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Compartir sitio de empleo" })).toBeNull();
});

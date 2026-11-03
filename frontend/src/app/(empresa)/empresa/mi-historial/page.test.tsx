import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("@/components/company-dashboard/site-header", () => ({ SiteHeader: ({ title }: { title: string }) => <header><h1>{title}</h1></header> }));
vi.mock("@/features/vacancy-assignments/page", () => ({ AssignmentHistoryPage: () => <div>Historial propio</div> }));
import Page, { metadata } from "./page";
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });
it.each([undefined, "0", "other"])("hides the page when the flag is %s", flag => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE", flag);
  expect(() => Page()).toThrow("NEXT_NOT_FOUND");
});
it.each(["1", "api"])("hides production even when opted in with %s", flag => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE", flag);
  expect(() => Page()).toThrow("NEXT_NOT_FOUND");
});
it.each(["1", "api"])("uses the existing employer shell composition for %s", flag => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE", flag);
  const { container } = render(<Page />);
  expect(metadata.title).toBe("Mi historial de vacantes");
  expect(screen.getByRole("heading", { name: "Mi historial de vacantes" })).toBeInTheDocument();
  expect(container.querySelector('[data-pf-page-content]')).toHaveClass("max-w-screen-2xl", "px-4", "lg:px-6");
  expect(screen.getByText("Historial propio")).toBeInTheDocument();
});

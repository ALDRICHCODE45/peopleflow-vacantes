import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { notFound } from "next/navigation";
import { loadDraftSubstatesAction } from "@/features/jobs/drafts/pipeline/substates-actions";
import { VacancySubstatesModule } from "@/features/employer-vacancies/vacancy-config/substates-module";
import Page, { metadata } from "./page";
vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }) }));
vi.mock("@/features/jobs/drafts/pipeline/substates-actions", () => ({ loadDraftSubstatesAction: vi.fn() }));
vi.mock("@/features/employer-vacancies/vacancy-config/substates-module", () => ({ VacancySubstatesModule: vi.fn(() => <div data-testid="substates-module" />) }));
const id = "123e4567-e89b-42d3-a456-426614174000";
beforeEach(() => vi.clearAllMocks()); afterEach(cleanup);
it("names the subsection and delegates without reading private data or adding a header", async () => {
  expect(metadata).toEqual({ title: "Subestados · Configuración" });
  const { container } = render(await Page({ params: Promise.resolve({ jobId: id }) }));
  expect(screen.getByTestId("substates-module")).toBeVisible(); expect(VacancySubstatesModule).toHaveBeenCalledWith({ draftId: id }, undefined);
  expect(loadDraftSubstatesAction).not.toHaveBeenCalled(); expect(container.querySelector("header")).toBeNull();
});
it.each(["bad", "../nuevo", "", "backend-developer-senior"])("rejects invalid UUID %j before mounting", async jobId => {
  await expect(Page({ params: Promise.resolve({ jobId }) })).rejects.toThrow("NEXT_NOT_FOUND"); expect(notFound).toHaveBeenCalledOnce(); expect(VacancySubstatesModule).not.toHaveBeenCalled();
});

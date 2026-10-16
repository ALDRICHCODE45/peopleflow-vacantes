import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { notFound } from "next/navigation";
import { loadDraftPipelineAction } from "@/features/jobs/drafts/pipeline/actions";
import { VacancyColumnsModule } from "@/features/employer-vacancies/vacancy-config/columns-module";
import Page, { metadata } from "./page";
vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }) }));
vi.mock("@/features/jobs/drafts/pipeline/actions", () => ({ loadDraftPipelineAction: vi.fn() }));
vi.mock("@/features/employer-vacancies/vacancy-config/columns-module", () => ({ VacancyColumnsModule: vi.fn(() => <div data-testid="columns-module" />) }));
const id = "123e4567-e89b-42d3-a456-426614174000";
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
it("names the sub-module and delegates loading without reading private data or adding a header", async () => {
  expect(metadata).toEqual({ title: "Columnas del pipeline · Configuración" });
  const { container } = render(await Page({ params: Promise.resolve({ jobId: id }) }));
  expect(screen.getByTestId("columns-module")).toBeVisible();
  expect(VacancyColumnsModule).toHaveBeenCalledWith({ draftId: id }, undefined);
  expect(loadDraftPipelineAction).not.toHaveBeenCalled();
  expect(container.querySelector("header")).toBeNull();
});
it.each(["bad", "../nuevo", "", "backend-developer-senior"])("rejects invalid UUID %j before mounting the module", async jobId => {
  await expect(Page({ params: Promise.resolve({ jobId }) })).rejects.toThrow("NEXT_NOT_FOUND");
  expect(notFound).toHaveBeenCalledOnce();
  expect(VacancyColumnsModule).not.toHaveBeenCalled();
});

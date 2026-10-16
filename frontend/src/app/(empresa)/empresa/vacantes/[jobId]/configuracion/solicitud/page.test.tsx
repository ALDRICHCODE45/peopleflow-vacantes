import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { notFound } from "next/navigation";
import { loadDraftManagementAction } from "@/features/jobs/drafts/pipeline/management-actions";
import { VacancyManagementModule } from "@/features/employer-vacancies/vacancy-config/management-module";
import Page, { metadata } from "./page";
vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }) }));
vi.mock("@/features/jobs/drafts/pipeline/management-actions", () => ({ loadDraftManagementAction: vi.fn() }));
vi.mock("@/features/employer-vacancies/vacancy-config/management-module", () => ({ VacancyManagementModule: vi.fn(() => <div data-testid="management-module" />) }));
const id = "123e4567-e89b-42d3-a456-426614174000";
beforeEach(() => vi.clearAllMocks()); afterEach(cleanup);
it("names Solicitud and delegates reads without adding another header", async () => {
  expect(metadata).toEqual({ title: "Solicitud · Configuración" }); const { container } = render(await Page({ params: Promise.resolve({ jobId: id }) })); expect(screen.getByTestId("management-module")).toBeVisible(); expect(VacancyManagementModule).toHaveBeenCalledWith({ draftId: id }, undefined); expect(loadDraftManagementAction).not.toHaveBeenCalled(); expect(container.querySelector("header")).toBeNull();
});
it.each(["bad", "../nuevo", "", "backend-developer-senior"])("rejects invalid UUID %j before module", async jobId => { await expect(Page({ params: Promise.resolve({ jobId }) })).rejects.toThrow("NEXT_NOT_FOUND"); expect(notFound).toHaveBeenCalledOnce(); expect(VacancyManagementModule).not.toHaveBeenCalled(); });

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { notFound } from "next/navigation";
import { VacancyPsychometricsModule } from "@/features/psychometrics/profile";
import Page, { metadata } from "./page";
vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }) }));
vi.mock("@/features/psychometrics/profile", () => ({ VacancyPsychometricsModule: vi.fn(() => <div data-testid="psychometrics-module" />) }));
const id = "123e4567-e89b-42d3-a456-426614174000";
beforeEach(() => vi.clearAllMocks()); afterEach(cleanup);
it("names Psicometría and delegates to the module without adding another header", async () => {
  expect(metadata).toEqual({ title: "Psicometría · Configuración" }); const { container } = render(await Page({ params: Promise.resolve({ jobId: id }) })); expect(screen.getByTestId("psychometrics-module")).toBeVisible(); expect(VacancyPsychometricsModule).toHaveBeenCalledWith({ draftId: id }, undefined); expect(container.querySelector("header")).toBeNull();
});
it.each(["bad", "../nuevo", "", "backend-developer-senior"])("rejects invalid UUID %j before module", async jobId => { await expect(Page({ params: Promise.resolve({ jobId }) })).rejects.toThrow("NEXT_NOT_FOUND"); expect(notFound).toHaveBeenCalledOnce(); expect(VacancyPsychometricsModule).not.toHaveBeenCalled(); });

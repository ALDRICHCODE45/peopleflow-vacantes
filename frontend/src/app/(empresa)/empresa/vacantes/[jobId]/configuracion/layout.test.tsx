import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { notFound } from "next/navigation";
import { loadDraftForEditAction } from "@/features/jobs/drafts/reopen/load";
import { VacancyConfigShell } from "@/features/employer-vacancies/vacancy-config/shell";
import Layout, { dynamic } from "./layout";
vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }) }));
vi.mock("@/features/jobs/drafts/reopen/load", () => ({ loadDraftForEditAction: vi.fn() }));
vi.mock("@/features/employer-vacancies/vacancy-config/shell", () => ({ VacancyConfigShell: vi.fn(({ children }: { children: React.ReactNode }) => <div>{children}</div>) }));
const id = "123e4567-e89b-42d3-a456-426614174000";
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
it("stays dynamic and delegates the children to the single client shell without a server read", async () => {
  expect(dynamic).toBe("force-dynamic");
  const children = <p>Contenido del apartado</p>;
  render(await Layout({ params: Promise.resolve({ jobId: id }), children }));
  expect(screen.getByText("Contenido del apartado")).toBeVisible();
  expect(VacancyConfigShell).toHaveBeenCalledWith({ draftId: id, children }, undefined);
  expect(loadDraftForEditAction).not.toHaveBeenCalled();
});
it.each(["bad", "../nuevo", "", "backend-developer-senior"])("rejects invalid UUID %j before mounting the shell", async jobId => {
  await expect(Layout({ params: Promise.resolve({ jobId }), children: <p>Contenido</p> })).rejects.toThrow("NEXT_NOT_FOUND");
  expect(notFound).toHaveBeenCalledOnce();
  expect(VacancyConfigShell).not.toHaveBeenCalled();
});

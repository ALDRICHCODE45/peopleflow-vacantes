import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { DraftListRow } from "@/features/jobs/drafts/list/client";
import { ActiveVacancies } from "./active-vacancies";
afterEach(cleanup);
const row = { id: "v", title: "Plataforma real", status: "published", work_mode: "remote", work_schedule: "full_time", candidates: { in_process: 8, total: 99 } } as DraftListRow;
it("uses only published rows and the in-process count rather than historical total", () => {
  render(<ActiveVacancies vacancies={[row, { ...row, id: "paused", status: "paused", title: "Oculta" }]} />);
  expect(screen.getByText("Plataforma real")).toBeInTheDocument(); expect(screen.queryByText("Oculta")).toBeNull();
  expect(screen.getByText("8 candidatos en proceso")).toBeInTheDocument(); expect(screen.getByText("Remoto · Tiempo completo")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Ver pipeline de Plataforma real" })).toHaveAttribute("href", "/empresa/vacantes/v/pipeline");
});
it("supports absent schedule and work mode", () => { render(<ActiveVacancies vacancies={[{ ...row, work_mode: null, work_schedule: null }]} />); expect(screen.getByText("Plataforma real")).toBeInTheDocument(); });
it("keeps the shared empty state", () => { render(<ActiveVacancies vacancies={[]} />); expect(screen.getByText("No hay vacantes activas")).toBeInTheDocument(); expect(document.querySelector('[data-slot="empty"]')).not.toBeNull(); });

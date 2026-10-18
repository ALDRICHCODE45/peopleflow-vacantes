import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { listItem, vacancyDetail } from "../api/public-fixtures";
import { PublicVacancyCard } from "./PublicVacancyCard";

const NOW = new Date("2026-10-18T12:00:00Z");
afterEach(() => { cleanup(); vi.useRealTimers(); });
it.each([
  ["2026-10-18T11:59:45Z", "Hace unos instantes"],
  ["2026-10-18T11:58:00Z", "Hace 2 min"],
  ["2026-10-18T10:00:00Z", "Hace 2 h"],
  ["2026-10-17T10:00:00Z", "Ayer"],
  ["2026-10-15T10:00:00Z", "Hace 3 días"],
  ["2026-10-01T10:00:00Z", "1 de octubre de 2026"],
  ["2026-10-18T14:00:00Z", "18 de octubre de 2026"],
])("formats the real publication %s as %s", (published_at, label) => {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  render(<PublicVacancyCard job={{ ...listItem(vacancyDetail), published_at }} />);
  expect(screen.getByText(label, { selector: "time" })).toHaveAttribute("datetime", published_at);
});
it("refreshes time and expires Nueva while the list remains open", async () => {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  render(<PublicVacancyCard job={{ ...listItem(vacancyDetail), published_at: "2026-10-16T12:01:00Z" }} />);
  expect(screen.getByText("Nueva")).toBeVisible();
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(screen.queryByText("Nueva")).toBeNull();
});

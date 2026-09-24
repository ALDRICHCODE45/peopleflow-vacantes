import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import * as CalendarModule from "./calendar";
import { Calendar, CalendarDayButton } from "./calendar";
import { es } from "date-fns/locale";

const JANUARY_2025 = new Date(2025, 0, 1);
const SELECTED_DAY = new Date(2025, 0, 15);

function findByText(role: "button" | "gridcell", day: number): HTMLElement {
  const match = screen
    .getAllByRole(role)
    .find((node) => node.textContent?.trim() === String(day));
  if (!match) throw new Error(`No rendered ${role} for day ${day}`);
  return match as HTMLElement;
}
const dayButton = (day: number) =>
  findByText("button", day) as HTMLButtonElement;
const gridCell = (day: number) => findByText("gridcell", day);
const calendarSource = () =>
  readFileSync(join(process.cwd(), "src/components/ui/calendar.tsx"), "utf8");

describe("Calendar official wrapper", () => {
  it("exports only the official wrapper components", () => {
    expect(Object.keys(CalendarModule).sort()).toEqual([
      "Calendar",
      "CalendarDayButton",
    ]);
    expect(typeof Calendar).toBe("function");
    expect(typeof CalendarDayButton).toBe("function");
  });

  it("keeps the official react-day-picker and repository primitive boundary", () => {
    const source = calendarSource();
    expect(source).toContain('from "react-day-picker"');
    expect(source).toContain("getDefaultClassNames");
    expect(source).toContain('from "cn"');
    expect(source).toContain('from "@/components/ui/button"');
    expect(source).toContain("buttonVariants");
    expect(source).toContain('from "lucide-react"');
    expect(source).toContain('"use client"');
    expect(source).not.toMatch(
      /@\/features|@\/app|createJob|CreateJobRequestSchema|fetch\(/,
    );
  });

  it("localizes the month grid, weekday headers, and day labels to Spanish", () => {
    render(<Calendar mode="single" defaultMonth={JANUARY_2025} locale={es} />);

    expect(screen.getByRole("grid")).toHaveAccessibleName("enero 2025");

    // Spanish narrow weekdays also prove the locale first-day-of-week option.
    const headers = document.querySelectorAll<HTMLTableCellElement>(
      ".rdp-weekdays th",
    );
    const weekdays = Array.from(headers, (header) => header.textContent);
    expect(weekdays).toEqual(["lu", "ma", "mi", "ju", "vi", "sá", "do"]);
    const labels = Array.from(headers, (header) =>
      header.getAttribute("aria-label"),
    );
    expect(labels).toEqual([
      "lunes",
      "martes",
      "miércoles",
      "jueves",
      "viernes",
      "sábado",
      "domingo",
    ]);
    expect(dayButton(15)).toHaveAttribute(
      "data-day",
      SELECTED_DAY.toLocaleDateString("es"),
    );
  });

  it("exposes grid, day button, and selection semantics", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Calendar mode="single" defaultMonth={JANUARY_2025} selected={SELECTED_DAY} onSelect={onSelect} />);

    expect(screen.getByRole("grid")).toBeInTheDocument();
    expect(screen.getAllByRole("gridcell")).toHaveLength(35);
    expect(gridCell(15)).toContainElement(dayButton(15));
    expect(dayButton(15)).toHaveTextContent("15");
    expect(gridCell(15)).toHaveAttribute("aria-selected", "true");
    expect(dayButton(15)).toHaveAttribute("data-selected-single", "true");

    await user.click(dayButton(20));

    expect(onSelect).toHaveBeenCalledTimes(1);
    const reported = onSelect.mock.calls[0][0] as Date;
    expect([reported.getFullYear(), reported.getMonth(), reported.getDate()]).toEqual([2025, 0, 20]);
  });

  it("moves the ArrowRight focus target from the auto-focused selected day", async () => {
    render(<Calendar mode="single" defaultMonth={JANUARY_2025} selected={SELECTED_DAY} autoFocus />);

    await waitFor(() =>
      expect(gridCell(15)).toHaveAttribute("data-focused", "true"),
    );
    expect(dayButton(15)).toHaveAttribute("tabindex", "0");
    expect(gridCell(16)).not.toHaveAttribute("data-focused");

    fireEvent.keyDown(dayButton(15), { key: "ArrowRight" });

    await waitFor(() => expect(dayButton(16)).toHaveFocus());
    expect(gridCell(16)).toHaveAttribute("data-focused", "true");
    expect(gridCell(15)).not.toHaveAttribute("data-focused");
  });

  it("merges caller className and classNames without dropping official classes", () => {
    const { container } = render(
      <Calendar mode="single" defaultMonth={JANUARY_2025} className="custom-shadow" classNames={{ nav: "custom-nav" }} />,
    );

    const root = container.querySelector<HTMLElement>('[data-slot="calendar"]');
    expect(root).toHaveClass("custom-shadow");
    expect(root).toHaveClass("group/calendar");
    expect(root?.className).toContain("bg-background");
    expect(container.querySelector(".custom-nav")).not.toBeNull();
    expect(gridCell(15)).toHaveClass("group/day");
    expect(gridCell(15)).toHaveClass("rdp-day");
    expect(dayButton(15)).toHaveClass("rdp-day_button");
  });
});

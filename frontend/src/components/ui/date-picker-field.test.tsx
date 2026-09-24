import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Layered unit boundary for NVS-10D. Both popup primitives are replaced by a
// small controlled harness, because the real Base UI close path refocus-loops
// under jsdom no matter how the popup is closed (controlled open toggle, the
// documented imperative `actionsRef.close()`, real or mocked DayPicker). That is
// an environment boundary, not production behavior: the committed Popover suite
// covers primitive focus restoration, and NVS-11 Playwright must prove the real
// composed portal open/select/close/focus cycle in a browser.
type PopoverHarness = {
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
  children?: React.ReactNode;
};
const popover = vi.hoisted(() => ({ open: false, setOpen: undefined as unknown }));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ open, onOpenChange, children }: PopoverHarness) => {
    popover.open = Boolean(open);
    popover.setOpen = onOpenChange;
    return <div data-slot="probe-popover">{children}</div>;
  },
  PopoverTrigger: ({ render }: { render: React.ReactElement<{ onClick?: () => void }> }) =>
    React.cloneElement(render, {
      onClick: () => (popover.setOpen as (next: boolean) => void)(true),
    }),
  PopoverContent: ({ children }: { children?: React.ReactNode }) =>
    popover.open ? (
      <div role="dialog" data-open>
        {children}
      </div>
    ) : null,
}));

// The calendar boundary exposes the props this field must supply and offers one
// past day and one valid day, so both the rejection guard and the civil
// `YYYY-MM-DD` emission stay observable without a real grid.
type CalendarProbe = {
  mode?: string;
  locale?: { code?: string };
  selected?: Date;
  disabled?: { before?: Date; after?: Date };
  onSelect?: (date: Date | undefined) => void;
};
const calendar = vi.hoisted(() => ({ props: undefined as unknown }));

vi.mock("@/components/ui/calendar", () => ({
  Calendar: (props: CalendarProbe) => {
    calendar.props = props;
    return (
      <div data-slot="probe-calendar" data-locale={props.locale?.code} data-mode={props.mode}>
        <button type="button" aria-label="Día 10" onClick={() => props.onSelect?.(new Date(2026, 0, 10))} />
        <button type="button" aria-label="Día 20" onClick={() => props.onSelect?.(new Date(2026, 0, 20))} />
      </div>
    );
  },
}));

import { DatePickerField } from "./date-picker-field";

const source = readFileSync(
  join(process.cwd(), "src/components/ui/date-picker-field.tsx"),
  "utf8",
);
const PLACEHOLDER = "Elegí una fecha";
/** The props received by the most recent calendar render. */
const calendarProps = () => calendar.props as CalendarProbe;
const trigger = () => screen.getByRole("button", { name: "Fecha de cierre" });

beforeEach(() => {
  vi.setSystemTime(new Date(2026, 0, 15, 12));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderField(props: Partial<Parameters<typeof DatePickerField>[0]> = {}) {
  const onChange = vi.fn();
  const view = render(
    <>
      <span id="closing-date-label">Fecha de cierre</span>
      <DatePickerField
        id="vacancy-closing-date"
        value=""
        onChange={onChange}
        aria-labelledby="closing-date-label"
        {...props}
      />
    </>,
  );
  return { ...view, onChange };
}


describe("DatePickerField", () => {
  it("composes the committed popover and calendar with the Spanish locale and no UTC round-trip", () => {
    expect(source).toMatch(/from "@\/components\/ui\/popover"/u);
    expect(source).toMatch(/from "@\/components\/ui\/calendar"/u);
    expect(source).toContain("<PopoverContent");
    expect(source).toContain("<Calendar");
    expect(source).toContain("locale={es}");
    expect(source).not.toMatch(/new Date\(value\)|Date\.parse\(|toISOString\(/u);
  });
  it("shows the Spanish placeholder for blank and invalid values", () => {
    for (const value of ["", "no-es-fecha", "2026-1-5", "2026-02-30"]) {
      const view = renderField({ value });
      expect(trigger()).toHaveTextContent(PLACEHOLDER);
      view.unmount();
    }
  });
  it("shows the Spanish long date without shifting the civil day", () => {
    renderField({ value: "2026-12-31" });
    expect(trigger()).toHaveTextContent("31 de diciembre de 2026");
    expect(trigger()).not.toHaveTextContent(PLACEHOLDER);
  });
  it("keeps the trigger shrinkable and truncates its label without losing the full date", () => {
    renderField({ value: "2026-12-31" });
    const button = trigger();
    // The frame must not push long Spanish dates into adjoining grid columns.
    expect(button.className).toContain("min-w-0");
    expect(button.className).toContain("overflow-hidden");
    const label = button.querySelector("span") as HTMLElement;
    for (const token of ["min-w-0", "flex-1", "truncate", "text-left"]) expect(label.className, token).toContain(token);
    // Truncation is visual only: the full civil date stays the rendered label text.
    expect(label).toHaveTextContent("31 de diciembre de 2026");
    expect(source).toContain("truncate");
  });
  it("reports an error through the trigger and its message", () => {
    renderField({ error: "Elegí una fecha de cierre válida." });
    expect(trigger()).toHaveAttribute("aria-invalid", "true");
    expect(trigger()).toHaveAttribute("aria-describedby", "vacancy-closing-date-error");
    expect(document.getElementById("vacancy-closing-date-error")).toHaveTextContent(
      "Elegí una fecha de cierre válida.",
    );
  });
  it("can be disabled and reports no error state by default", () => {
    renderField({ disabled: true });
    expect(trigger()).toBeDisabled();
    expect(trigger()).not.toHaveAttribute("aria-invalid");
    expect(trigger()).not.toHaveAttribute("aria-describedby");
  });
  it("hands the calendar a single-mode Spanish day with a past boundary", () => {
    renderField({ value: "2026-12-31" });
    fireEvent.click(trigger());
    const selected = calendarProps().selected as Date;
    expect(calendarProps().mode).toBe("single");
    expect([selected.getFullYear(), selected.getMonth(), selected.getDate()]).toEqual([2026, 11, 31]);
    expect(calendarProps().disabled?.before).toEqual(new Date(2026, 0, 15));
    // Backward compatibility: without the past-date mode the upper bound stays open.
    expect(calendarProps().disabled?.after).toBeUndefined();
  });
  it("opens a past window for birth dates while still blocking future days", () => {
    const onChange = vi.fn();
    // The backward-compatible past-date mode this field must gain for birth dates.
    const props = { id: "profile-birthDate", value: "", onChange, "aria-labelledby": "birth-date-label", allowPast: true } as Parameters<typeof DatePickerField>[0] & { allowPast?: boolean };
    render(<><span id="birth-date-label">Fecha de nacimiento</span><DatePickerField {...props} /></>);
    fireEvent.click(screen.getByRole("button", { name: "Fecha de nacimiento" }));
    expect(calendarProps().mode).toBe("single");
    expect(calendarProps().disabled?.before).toBeUndefined();
    expect(calendarProps().disabled?.after).toEqual(new Date(2026, 0, 15));
    fireEvent.click(screen.getByRole("button", { name: "Día 20" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveAttribute("data-open");
    fireEvent.click(screen.getByRole("button", { name: "Día 10" }));
    expect(onChange).toHaveBeenCalledWith("2026-01-10");
  });
  it("opens Spanish, keeps a rejected past day open, emits a valid civil date, and closes", () => {
    const { onChange } = renderField();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(trigger());
    expect(screen.getByRole("dialog")).toHaveAttribute("data-open");
    const probe = document.querySelector('[data-slot="probe-calendar"]');
    expect(probe).toHaveAttribute("data-locale", "es");
    expect(probe).toHaveAttribute("data-mode", "single");

    fireEvent.click(screen.getByRole("button", { name: "Día 10" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveAttribute("data-open");

    fireEvent.click(screen.getByRole("button", { name: "Día 20" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-01-20");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

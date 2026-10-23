import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { OriginTabs } from "./origin-tabs";
afterEach(cleanup);
it("renders both counters as badges and the organization note", () => {
  render(<OriginTabs value="all" onValueChange={vi.fn()} counts={{ all: 8, manual: 3 }} />);
  expect(screen.getByRole("tablist", { name: "Origen de los candidatos" })).toHaveAttribute("data-variant", "line");
  const all = screen.getByRole("tab", { name: "Todos los candidatos 8" });
  const manual = screen.getByRole("tab", { name: "Agregados por mi equipo 3" });
  expect(all).toHaveAttribute("aria-selected", "true");
  for (const [tab, count] of [[all, "8"], [manual, "3"]] as const) {
    expect(within(tab).getByText(count)).toHaveAttribute("data-slot", "badge");
  }
  expect(screen.getByText("Solo tu organización")).toBeVisible();
});
it("hides unknown counters rather than inventing zeros and shows known zero counts", () => {
  const { container, rerender } = render(<OriginTabs value="all" onValueChange={vi.fn()} />);
  expect(container.querySelector('[data-slot="badge"]')).not.toBeInTheDocument();
  rerender(<OriginTabs value="manual" onValueChange={vi.fn()} counts={{ all: 0, manual: 0 }} />);
  expect(screen.getAllByText("0")).toHaveLength(2);
});
it("reports selection but stays controlled until its value changes", async () => {
  const onValueChange = vi.fn();
  const { rerender } = render(<OriginTabs value="all" onValueChange={onValueChange} />);
  await userEvent.click(screen.getByRole("tab", { name: "Agregados por mi equipo" }));
  expect(onValueChange).toHaveBeenCalledWith("manual");
  expect(screen.getByRole("tab", { name: "Todos los candidatos" })).toHaveAttribute("aria-selected", "true");
  rerender(<OriginTabs value="manual" onValueChange={onValueChange} />);
  expect(screen.getByRole("tab", { name: "Agregados por mi equipo" })).toHaveAttribute("aria-selected", "true");
});
it("supports keyboard selection", async () => {
  function Controlled() {
    const [value, setValue] = useState<"all" | "manual">("all");
    return <OriginTabs value={value} onValueChange={setValue} />;
  }
  render(<Controlled />);
  act(() => screen.getByRole("tab", { name: "Todos los candidatos" }).focus());
  await userEvent.keyboard("{ArrowRight}{Enter}");
  expect(screen.getByRole("tab", { name: "Agregados por mi equipo" })).toHaveAttribute("aria-selected", "true");
});

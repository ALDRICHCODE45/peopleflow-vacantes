import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useScrollHint } from "./scroll-hint";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function Rail() {
  const { ref, hint } = useScrollHint<HTMLDivElement>();
  return <div ref={ref} data-testid="rail" {...hint}><div>tabs</div></div>;
}
function layout(el: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
}
it("hints at the hidden side of an overflowing rail and drops the hint once everything fits", () => {
  render(<Rail />);
  const rail = screen.getByTestId("rail");
  layout(rail, 480, 300);
  fireEvent.scroll(rail);
  expect(rail).toHaveAttribute("data-fade", "end");
  rail.scrollLeft = 90; fireEvent.scroll(rail);
  expect(rail).toHaveAttribute("data-fade", "both");
  rail.scrollLeft = 180; fireEvent.scroll(rail);
  expect(rail).toHaveAttribute("data-fade", "start");
  layout(rail, 300, 300); rail.scrollLeft = 0; act(() => { fireEvent.scroll(rail); });
  expect(rail).not.toHaveAttribute("data-fade");
});

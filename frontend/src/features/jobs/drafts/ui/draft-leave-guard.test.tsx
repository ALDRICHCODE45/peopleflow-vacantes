import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DraftLeaveGuard, type DraftLeaveGuardHandle } from "./draft-leave-guard";

const nextState = { __NA: true, tree: ["editor"] };
let push: ReturnType<typeof vi.spyOn>;
let go: ReturnType<typeof vi.spyOn>;
function back() {
  // jsdom traversal is asynchronous; model arriving at the original editor entry.
  history.replaceState(nextState, "", "/editor");
  fireEvent.popState(window, { state: nextState });
}
beforeEach(() => {
  history.replaceState(nextState, "", "/editor");
  push = vi.spyOn(history, "pushState");
  go = vi.spyOn(history, "go").mockImplementation(() => {});
});
afterEach(async () => {
  cleanup();
  await act(async () => {});
  vi.restoreAllMocks();
});
it("awaits its own release popstate without prompting and shares concurrent releases", async () => {
  const ref = React.createRef<DraftLeaveGuardHandle>();
  render(<DraftLeaveGuard ref={ref} dirty />);
  const release = ref.current!.releaseSentinel();
  expect(ref.current!.releaseSentinel()).toBe(release);
  expect(go).toHaveBeenCalledExactlyOnceWith(-1);
  back();
  expect(await release).toBe(true);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(push).toHaveBeenCalledTimes(1);
  expect(await ref.current!.releaseSentinel()).toBe(true);
  expect(go).toHaveBeenCalledTimes(1);
});
it("times out safely instead of authorizing URL replacement on a stuck sentinel", async () => {
  vi.useFakeTimers();
  try {
    const ref = React.createRef<DraftLeaveGuardHandle>();
    render(<DraftLeaveGuard ref={ref} dirty />);
    const release = ref.current!.releaseSentinel();
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(await release).toBe(false);
    expect(history.state).toHaveProperty("__draftLeaveGuard");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
it("adds exactly one sentinel and preserves Next state across rerenders and StrictMode", () => {
  const view = render(<React.StrictMode><DraftLeaveGuard dirty /></React.StrictMode>);
  view.rerender(<React.StrictMode><DraftLeaveGuard dirty /></React.StrictMode>);
  expect(push).toHaveBeenCalledTimes(1);
  expect(history.state).toMatchObject(nextState);
  expect(location.pathname).toBe("/editor");
});
it("re-pushes on Back and cancelling preserves the mounted form and title", () => {
  render(<><input aria-label="Título" defaultValue="Backend" /><DraftLeaveGuard dirty /></>);
  const title = screen.getByRole("textbox", { name: "Título" });
  back();
  expect(screen.getByRole("alertdialog")).toHaveTextContent("Tienes cambios sin guardar");
  expect(screen.getByRole("alertdialog")).toHaveTextContent("Si sales ahora, perderás los cambios que no guardaste.");
  expect(push).toHaveBeenCalledTimes(2);
  expect(location.pathname).toBe("/editor");
  fireEvent.click(screen.getByRole("button", { name: "Continuar editando" }));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Título" })).toBe(title);
  expect(title).toHaveValue("Backend");
  expect(go).not.toHaveBeenCalled();
});
it("one confirmation leaves past the sentinel exactly once", () => {
  render(<DraftLeaveGuard dirty />);
  back();
  fireEvent.click(screen.getByRole("button", { name: "Salir de todos modos" }));
  expect(go).toHaveBeenCalledExactlyOnceWith(-2);
  fireEvent.popState(window, { state: null });
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(push).toHaveBeenCalledTimes(2);
});
it("removes the current sentinel when saved without prompting", async () => {
  const view = render(<DraftLeaveGuard dirty />);
  view.rerender(<DraftLeaveGuard dirty={false} />);
  await act(async () => {});
  expect(go).toHaveBeenCalledExactlyOnceWith(-1);
  fireEvent.popState(window, { state: nextState });
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});
it("does not remove another owner's history entry", async () => {
  const view = render(<DraftLeaveGuard dirty />);
  history.replaceState(nextState, "", "/another");
  view.rerender(<DraftLeaveGuard dirty={false} />);
  await act(async () => {});
  expect(go).not.toHaveBeenCalled();
});
it("clean editors do not add a sentinel or intercept popstate", () => {
  render(<DraftLeaveGuard dirty={false} />);
  back();
  expect(push).not.toHaveBeenCalled();
  expect(go).not.toHaveBeenCalled();
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});
it("does not reopen an obsolete Back prompt after saving and editing again", async () => {
  const view = render(<DraftLeaveGuard dirty />);
  back();
  view.rerender(<DraftLeaveGuard dirty={false} />);
  await act(async () => {});
  history.replaceState(nextState, "", "/editor");
  view.rerender(<DraftLeaveGuard dirty />);
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});
it("removes an owned current entry on unmount but never double-traverses a confirmed Back", async () => {
  const view = render(<DraftLeaveGuard dirty />);
  back();
  fireEvent.click(screen.getByRole("button", { name: "Salir de todos modos" }));
  view.unmount();
  await act(async () => {});
  expect(go).toHaveBeenCalledExactlyOnceWith(-2);
});
it("keeps the default wording and the destructive button for the vacancy editor", () => {
  render(<DraftLeaveGuard dirty />);
  back();
  const dialog = screen.getByRole("alertdialog");
  expect(dialog.querySelector("[data-slot='alert-dialog-media']")).not.toBeNull();
  expect(screen.getByRole("alertdialog")).toHaveTextContent("Tienes cambios sin guardar");
});
const SHEET_PROMPT = { title: "¿Salir sin guardar los cambios?", description: "Cambiaste algo y todavía no lo guardas.", cancelLabel: "Seguir editando", confirmLabel: "Descartar cambios" } as const;
it("uses a caller's wording with no icon and a plain status-danger text button (contrast ≥ 4.5:1 incl. hover)", () => {
  render(<DraftLeaveGuard dirty prompt={SHEET_PROMPT} />);
  back();
  const dialog = screen.getByRole("alertdialog", { name: SHEET_PROMPT.title });
  expect(dialog).toHaveTextContent(SHEET_PROMPT.description);
  expect(dialog.querySelector("svg, [data-slot='alert-dialog-media']")).toBeNull();
  const discard = screen.getByRole("button", { name: "Descartar cambios" });
  expect(discard).toHaveClass("text-status-danger", "hover:text-status-danger", "hover:bg-status-danger/10");
  expect(discard.className).not.toMatch(/(^|\s)(dark:)?(hover:)?bg-destructive|(^|\s)text-destructive/);
  expect(screen.getByRole("button", { name: "Seguir editando" })).toHaveFocus();
});
it("the caller's wording confirms Back exactly like the default one", () => {
  render(<DraftLeaveGuard dirty prompt={SHEET_PROMPT} />);
  back();
  fireEvent.click(screen.getByRole("button", { name: "Descartar cambios" }));
  expect(go).toHaveBeenCalledExactlyOnceWith(-2);
});

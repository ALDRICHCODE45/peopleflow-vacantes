import { describe, expect, it } from "vitest";
import { COALESCE_MS, HISTORY_LIMIT, breakStep, createHistory, diffPath, recordStep, redoStep, undoStep, type History } from "./history";

const step = (value: string, focus = null) => ({ value, selection: null, focus });
const current = (value: string) => ({ value, selection: null });
describe("edit history", () => {
  it("undoes and redoes in order, and a new edit drops the redo branch", () => {
    let h: History<string> = createHistory();
    h = recordStep(h, step("a"), null, 0); h = recordStep(h, step("b"), null, 10);
    const first = undoStep(h, current("c"))!; expect(first.step.value).toBe("b");
    const second = undoStep(first.history, current("b"))!; expect(second.step.value).toBe("a");
    expect(undoStep(second.history, current("a"))).toBeNull();
    const again = redoStep(second.history, current("a"))!; expect(again.step.value).toBe("b");
    expect(recordStep(again.history, step("b"), null, 20).future).toEqual([]);
  });
  it("coalesces the same key while edits keep arriving within the window", () => {
    let h: History<string> = createHistory();
    h = recordStep(h, step("a"), "title", 0);
    h = recordStep(h, step("ab"), "title", COALESCE_MS - 1);
    h = recordStep(h, step("abc"), "title", 2 * COALESCE_MS - 2);
    expect(h.past.map(s => s.value)).toEqual(["a"]);
    h = recordStep(h, step("abcd"), "title", 3 * COALESCE_MS - 2);
    expect(h.past.map(s => s.value)).toEqual(["a", "abcd"]);
  });
  it("starts a new step for a different key, an uncoalescable edit or an explicit break", () => {
    let h: History<string> = createHistory();
    h = recordStep(h, step("a"), "title", 0); h = recordStep(h, step("b"), "subtitle", 1);
    h = recordStep(h, step("c"), null, 2); h = recordStep(h, step("d"), null, 3);
    h = recordStep(h, step("e"), "title", 4); h = recordStep(breakStep(h), step("f"), "title", 5);
    expect(h.past.map(s => s.value)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
  it("never coalesces into a step that was undone", () => {
    let h: History<string> = createHistory();
    h = recordStep(h, step("a"), "title", 0);
    h = undoStep(h, current("ab"))!.history;
    h = recordStep(h, step("a"), "title", 1);
    expect(h.past).toHaveLength(1); expect(h.future).toEqual([]);
  });
  it(`caps history at ${HISTORY_LIMIT} steps dropping the oldest`, () => {
    let h: History<number> = createHistory();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) h = recordStep(h, { value: i, selection: null, focus: null }, null, i);
    expect(h.past).toHaveLength(HISTORY_LIMIT); expect(h.past[0].value).toBe(5);
  });
  it("keeps the step focus on the inverse so redo re-targets the same thing", () => {
    let h: History<string> = createHistory();
    h = recordStep(h, { value: "a", selection: "s1", focus: { kind: "block", id: "x" } }, null, 0);
    const undone = undoStep(h, { value: "b", selection: "s2" })!;
    expect(undone.history.future[0]).toEqual({ value: "b", selection: "s2", focus: { kind: "block", id: "x" } });
    expect(redoStep(undone.history, { value: "a", selection: "x" })!.step.focus).toEqual({ kind: "block", id: "x" });
  });
  it("skips steps equal to the current value", () => {
    let h: History<string> = createHistory();
    h = recordStep(h, step("a"), null, 0); h = recordStep(h, step("b"), null, 1);
    expect(undoStep(h, current("b"), (x, y) => x === y)!.step.value).toBe("a");
  });
});
describe("diffPath", () => {
  it("returns the single changed leaf path, or null when several or the shape changed", () => {
    expect(diffPath({ title: "a", subtitle: null }, { title: "ab", subtitle: null })).toBe("title");
    expect(diffPath({ items: [{ q: "a" }, { q: "b" }] }, { items: [{ q: "a" }, { q: "bc" }] })).toBe("items.1.q");
    expect(diffPath({ items: [{ q: "a" }] }, { items: [{ q: "a" }, { q: "b" }] })).toBeNull();
    expect(diffPath({ title: "a", subtitle: "x" }, { title: "b", subtitle: "y" })).toBeNull();
    expect(diffPath({ title: null }, { title: "a" })).toBe("title");
    expect(diffPath("a", "b")).toBe("");
  });
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
vi.mock("@/features/psychometrics/workspace/load", () => ({ loadWorkspaceAssessmentsAction: vi.fn() }));
import { loadWorkspaceAssessmentsAction } from "@/features/psychometrics/workspace/load";
import type { AccountAssessment } from "@/features/psychometrics/model";
import { DashboardAssessments, type AssessmentResult } from "./assessments";

const assessment = (id: string, expires_at: string): AccountAssessment => ({ id, application_id: null, vacancy: { id: "v", title: "Vacante" }, company: { id: "c", name: "Empresa" }, status: "created", created_at: "2026-01-01T00:00:00Z", expires_at, finished_at: null, answered_count: 0, total_count: 63, estimated_minutes: 10 });
const loaded = (onResult: ReturnType<typeof vi.fn>) => onResult.mock.calls.map(([result]) => result as AssessmentResult).filter(result => result !== undefined);
const ids = (result: AssessmentResult) => result?.ok ? result.data.items.map(item => item.id) : [];

beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }); vi.setSystemTime(new Date("2026-11-18T12:00:00Z")); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });

it("forwards the eligible set once and stays quiet while the clock runs (no 1 s re-render)", async () => {
  vi.mocked(loadWorkspaceAssessmentsAction).mockResolvedValue({ ok: true, data: { items: [assessment("open", "2026-11-25T12:00:00Z"), assessment("gone", "2026-11-01T00:00:00Z")] } });
  const onResult = vi.fn();
  render(<DashboardAssessments onResult={onResult} />);
  await act(() => vi.advanceTimersByTimeAsync(0));
  // One act per second, so every tick of a ticker would commit on its own.
  for (let second = 0; second < 5; second++) await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(loaded(onResult)).toHaveLength(1);
  expect(ids(loaded(onResult)[0])).toEqual(["open"]);
  expect(vi.getTimerCount()).toBe(1);
});

it("schedules one timer to the next expiry and forwards the smaller set only when it passes", async () => {
  vi.mocked(loadWorkspaceAssessmentsAction).mockResolvedValue({ ok: true, data: { items: [assessment("soon", "2026-11-18T12:00:03Z"), assessment("later", "2026-11-18T12:00:08Z")] } });
  const onResult = vi.fn();
  render(<DashboardAssessments onResult={onResult} />);
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(loaded(onResult).map(ids)).toEqual([["soon", "later"]]);
  await act(() => vi.advanceTimersByTimeAsync(2900));
  expect(loaded(onResult)).toHaveLength(1);
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(loaded(onResult).map(ids)).toEqual([["soon", "later"], ["later"]]);
  await act(() => vi.advanceTimersByTimeAsync(5000));
  expect(loaded(onResult).map(ids)).toEqual([["soon", "later"], ["later"], []]);
  expect(vi.getTimerCount()).toBe(0);
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { historyDate } from "./history/history-presentation";
import { relativeTime } from "./relative-time";

const now = new Date("2026-10-22T20:00:00Z");
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => vi.useRealTimers());
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000).toISOString();

it("says «hace un momento» under a minute instead of «hace 0 segundos» (QA L15)", () => {
  expect(relativeTime(ago(0))).toBe("hace un momento");
  expect(relativeTime(ago(59))).toBe("hace un momento");
  expect(historyDate(ago(0))).toMatch(/ · hace un momento$/);
});
it("keeps minutes, hours and days", () => {
  expect(relativeTime(ago(5 * 60))).toBe("hace 5 minutos");
  expect(relativeTime(ago(3 * 3600))).toBe("hace 3 horas");
  expect(relativeTime(ago(2 * 86400))).toBe("hace 2 días");
});

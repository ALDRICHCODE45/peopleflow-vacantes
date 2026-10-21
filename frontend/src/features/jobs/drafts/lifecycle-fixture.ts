import type { Lifecycle } from "@/features/vacancy-lifecycle/model";

export const activeLifecycle: Lifecycle = {
  publication: "published", process: "active", version: "1",
  published_at: "2026-10-20T12:00:00Z", paused_at: null, closed_at: null,
  process_finished_at: null, allowed_actions: ["pause", "close"],
};
export const finishedLifecycle: Lifecycle = {
  ...activeLifecycle, publication: "closed", process: "finished", version: "2",
  closed_at: "2026-10-21T12:00:00Z", process_finished_at: "2026-10-21T12:00:00Z", allowed_actions: ["reopen"],
};

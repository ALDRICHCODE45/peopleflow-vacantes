import type { Management } from "@/features/jobs/drafts/pipeline/management-model";
export const managementFixture = (): Management => ({
  version: "0", requestDate: null, hiringHeadcount: null,
  limits: { maxHiringHeadcount: 999 }, today: "2026-10-16",
});

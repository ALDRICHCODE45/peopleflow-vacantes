import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

// Full-page and whole-section states must use the shared composition, not rebuild it.
it.each([
  "features/identity/identity-states.tsx",
  "features/candidate-cvs/storage-unavailable.tsx",
  "features/jobs/drafts/reopen/error-state.tsx",
  "features/jobs/components/JobsResults.tsx",
  "features/pipeline-movement/board-states.tsx",
  "features/pipeline-movement/candidate-sheet.tsx",
  "features/candidate-applications/wizard.tsx",
  "features/company-profile/company-careers-view.tsx",
  "components/candidate-dashboard/candidate-dashboard-overview.tsx",
  "components/company-dashboard/active-vacancies.tsx",
  "components/company-dashboard/data-table.tsx",
  "features/employer-team/team-workspace.tsx",
  "features/employer-talent/talent-table.tsx",
  "features/employer-vacancies/vacancy-portfolio.tsx",
  "features/employer-vacancies/pipeline-workspace.tsx",
  "features/employer-vacancies/delivery-config/fulfillment-view.tsx",
])("%s delegates section feedback to StateCard", (file) => {
  const source = readFileSync(resolve("src", file), "utf8");
  expect(source.includes('from "@/components/feedback/state-card"')).toBe(true);
  expect(source.includes("<StateCard")).toBe(true);
});

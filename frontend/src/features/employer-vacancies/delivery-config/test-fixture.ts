import type { Delivery } from "@/features/jobs/drafts/pipeline/delivery-model";
export const deliveryFixture = (): Delivery => ({
  fulfilled: false, version: "0", cutoffStageId: null, targetQuantity: null, commitmentDate: null,
  limits: { maxTargetQuantity: 999 },
  calendar: { timeZone: "America/Mexico_City", today: "2026-10-16", minDate: "2026-10-16", maxDate: "2027-10-16", nonBusinessDates: ["2026-10-17", "2026-10-18"] },
});

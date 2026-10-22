import { expect, it } from "vitest";
import { closeBodySchema, lifecycleSchema, closeCoverageMessage, closeReasonLabel } from "./model";

it.each(["filled", "cancelled", "other"] as const)("accepts close reason %s", reason => {
  expect(closeBodySchema.parse({ process: "continue", reason, reason_note: reason === "other" ? "  Cambio de planes  " : null })).toEqual({ process: "continue", reason, reason_note: reason === "other" ? "Cambio de planes" : null });
});
it.each([{}, { reason: "unknown", reason_note: null }, { reason: "other", reason_note: " \n " }, { reason: "other", reason_note: "a".repeat(201) }, { reason: "filled", reason_note: "no" }, { reason: "cancelled", reason_note: 2 }])("rejects invalid close %j", patch => {
  expect(closeBodySchema.safeParse({ process: "finish", ...patch }).success).toBe(false);
});
it("counts Unicode code points, not UTF-16 units", () => {
  expect(closeBodySchema.safeParse({ process: "finish", reason: "other", reason_note: "😀".repeat(200) }).success).toBe(true);
});
it("requires nullable close fields on lifecycle reads", () => {
  const view = { publication: "closed", process: "active", version: "1", published_at: null, paused_at: null, closed_at: null, process_finished_at: null, allowed_actions: [] };
  expect(lifecycleSchema.safeParse(view).success).toBe(false);
  for (const reason of [null, "filled", "cancelled", "other"]) expect(lifecycleSchema.safeParse({ ...view, close_reason: reason, close_reason_note: null }).success).toBe(true);
  for (const patch of [{ close_reason: 1 }, { close_reason: "bad" }, { close_reason_note: 1 }]) expect(lifecycleSchema.safeParse({ ...view, close_reason: null, close_reason_note: null, ...patch }).success).toBe(false);
});
it("explains coverage and labels historical closures", () => {
  expect(closeCoverageMessage({ covered: 1, required: 2 })).toBe("Hay 1 de 2 posiciones cubiertas.");
  expect(closeCoverageMessage({ covered: 0, required: 1 })).toBe("Hay 0 de 1 posición cubierta.");
  expect(closeCoverageMessage({ covered: 1, required: null })).toBe("Esta vacante no tiene un objetivo de posiciones.");
  expect(closeReasonLabel(null)).toBe("Sin motivo registrado");
  expect(closeReasonLabel("filled")).toBe("Cubierta");
  expect(closeReasonLabel("cancelled")).toBe("Cancelada");
  expect(closeReasonLabel("other")).toBe("Otro");
});

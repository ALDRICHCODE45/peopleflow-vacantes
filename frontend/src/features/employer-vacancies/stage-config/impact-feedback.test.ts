import { expect, it } from "vitest";
import { appliedImpactNotice } from "./feedback";
const candidate = { id: "a", full_name: "Ana" };
const entry = { participation_id: "a", candidate, stage_id: "s" };
const empty = { not_applicable: [], recovery_reassigned: [] };
it("counts candidates, not entries, and uses singular agreement", () => {
  expect(appliedImpactNotice({ ...empty, not_applicable: [entry, { ...entry, stage_id: "o" }] }).description).toBe('1 candidato quedó con "No aplica" en columnas nuevas o movidas.');
});
it("uses plural and compares applied identities rather than counts", () => {
  const applied = { ...empty, not_applicable: [entry, { ...entry, participation_id: "b" }] };
  expect(appliedImpactNotice(applied).description).toBe('2 candidatos quedaron con "No aplica" en columnas nuevas o movidas.');
  expect(appliedImpactNotice(applied, { ...applied, not_applicable: [entry, { ...entry, participation_id: "c" }] }).description).toContain("El impacto cambió desde la vista previa:");
  expect(appliedImpactNotice(applied, applied).description).not.toContain("cambió");
});
it("reports empty and recovery-only applied impact honestly", () => {
  expect(appliedImpactNotice(empty).title).toBe("Columnas guardadas.");
  expect(appliedImpactNotice(empty, { ...empty, not_applicable: [entry] }).description).toBe("El impacto cambió desde la vista previa: ningún candidato recibió cambios de proceso.");
  expect(appliedImpactNotice({ ...empty, recovery_reassigned: [{ participation_id: "a", candidate, retired_stage_id: "s", default_stage_id: "n" }] }).description).toBe("1 candidato elegirá columna al recuperarse.");
});

import type { SubstatesCatalog } from "@/features/jobs/drafts/pipeline/substates-model";

export function substatesFixture(): SubstatesCatalog {
  return { version: "0", substates: [], limits: { maxSubstates: 50, nameMaxLength: 40 }, suggestions: ["Primera entrevista", "Segunda entrevista", "Pruebas psicométricas", "Propuesta entregada"] };
}
export function populatedSubstates(): SubstatesCatalog {
  return { ...substatesFixture(), version: "1", substates: [{ id: "one", name: "Primera entrevista" }, { id: "two", name: "Técnica" }, { id: "three", name: "Propuesta" }] };
}

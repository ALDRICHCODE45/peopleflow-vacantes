import { expect, it } from "vitest";
import { suggestCriteria } from "@/features/vacancy-checklist/suggest";
import { checklistBodySchema } from "./model";
const id = "10000000-0000-4000-8000-000000000001";
it("suggests every structured source first with required importance and fresh UUIDs", () => {
  const fields = { min_years_of_experience: "3", seniority: "senior" as const, min_education_level: "bachelor" as const, accepts_in_progress_education: true, languages: [{ code: "en", min_level: "B2" as const }], skills: ["SQL"], work_mode: "hybrid" as const, location: { country: "MX", state: "09" }, required_requirements: "- Liderazgo\n* Gestión\n• Viajar\n1. Excel\n2) Ventas\n\n", preferred_requirements: "  Inglés  " };
  const questions = [{ id, type: "single_choice_evaluated" as const, prompt: "¿Licencia?", correct_option_id: id }, { id, type: "open" as const, prompt: "Otro" }];
  const result = suggestCriteria(fields, questions);
  expect(result.map(c => c.kind)).toEqual(["min_years_experience", "seniority", "education", "language", "skill", "location", "screening_answer", ...Array(6).fill("manual")]);
  expect(result[0].label).toBe("Al menos 3 años de experiencia");
  expect(result[2].params).toEqual({ min_level: "bachelor", accepts_in_progress: true });
  expect(result[5].params).toEqual({ country: "MX", states: ["09"] });
  expect(result[6].params).toEqual({ question_id: id, accepted_option_ids: [id] });
  expect(result.slice(7).map(c => c.label)).toEqual(["Liderazgo", "Gestión", "Viajar", "Excel", "Ventas", "Inglés"]);
  expect(result.slice(0, -1).every(c => c.importance === "required")).toBe(true); expect(result.at(-1)?.importance).toBe("desirable");
  expect(checklistBodySchema.safeParse({ criteria: result, reminder_stage_ids: [] }).success).toBe(true);
  expect(new Set([...result, ...suggestCriteria(fields, questions)].map(c => c.id)).size).toBe(result.length * 2);
});
it.each(["remote", null, undefined] as const)("does not suggest location for %s", work_mode => expect(suggestCriteria({ work_mode, location: { country: "MX" } }, [])).toEqual([]));
it("accepts the expanded location returned by draft GET", () => {
  const result = suggestCriteria({ work_mode: "onsite", location: { country: { id: "MX", name: "México" }, state: { id: "09", name: "CDMX" }, municipality: null, postal_code: null, label: "CDMX, México" } }, []);
  expect(result[0].params).toEqual({ country: "MX", states: ["09"] });
  expect(result[0].label).toContain("CDMX");
});
it("deduplicates accent-insensitive skills and skips missing onsite location", () => {
  const result = suggestCriteria({ skills: ["Análisis", " ANALISIS "], work_mode: "onsite" }, []);
  expect(result).toHaveLength(1);
});
it("handles empty fields and whole-country location", () => {
  expect(suggestCriteria({}, [])).toEqual([]);
  expect(suggestCriteria({ work_mode: "onsite", location: { country: "MX" } }, [])[0].params).toEqual({ country: "MX", states: [] });
});
it("caps at 50 with structured first; bounds long labels and skills", () => {
  const result = suggestCriteria({ skills: ["SQL", "sql", "x".repeat(100)], required_requirements: Array(60).fill("x".repeat(300)).join("\n") }, []);
  expect(result).toHaveLength(50); expect(result[0].kind).toBe("skill"); expect(result[1].kind).toBe("manual");
  expect(checklistBodySchema.safeParse({ criteria: result, reminder_stage_ids: [] }).success).toBe(true);
});

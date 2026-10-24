import { expect, it } from "vitest";
import { EMPLOYER_EMPLOYMENT_TYPE_LABELS, EMPLOYER_VACANCY_STATE_LABELS, EMPLOYER_WORK_MODE_LABELS, portfolioRowActions, vacancyPipelineHref } from "./model";
it("keeps the real portfolio's Spanish display dictionaries immutable", () => {
  expect(EMPLOYER_VACANCY_STATE_LABELS).toEqual({ active: "Activa", paused: "Pausada", closed: "Cerrada" });
  expect(EMPLOYER_WORK_MODE_LABELS).toEqual({ onsite: "Presencial", remote: "Remoto", hybrid: "Híbrido" });
  expect(EMPLOYER_EMPLOYMENT_TYPE_LABELS.full_time).toBe("Tiempo completo");
  for (const dictionary of [EMPLOYER_EMPLOYMENT_TYPE_LABELS, EMPLOYER_VACANCY_STATE_LABELS, EMPLOYER_WORK_MODE_LABELS]) expect(Object.isFrozen(dictionary)).toBe(true);
});
it("uses the same canonical backend vacancy route in both menus", () => {
  const id = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
  const href = `/empresa/vacantes/${id}/pipeline`;
  expect(vacancyPipelineHref(id)).toBe(href);
  expect(portfolioRowActions(id, "published")).toEqual([{ label: "Ver pipeline", kind: "pipeline", href }]);
  expect(portfolioRowActions(id, "draft").map(action => action.label)).toEqual(["Continuar editando", "Publicar", "Ver pipeline"]);
});

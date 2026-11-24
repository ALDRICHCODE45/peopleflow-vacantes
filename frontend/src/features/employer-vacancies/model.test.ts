import { expect, it } from "vitest";
import { EMPLOYER_EMPLOYMENT_TYPE_LABELS, EMPLOYER_VACANCY_STATE_LABELS, EMPLOYER_WORK_MODE_LABELS, hasPublicPage, isEditablePublication, portfolioRowActions, vacancyPipelineHref } from "./model";
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
it("adds the editor and the public page to a published vacancy's menu only when asked, and only a public published one has a page", () => {
  const id = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
  expect(portfolioRowActions(id, "published", { editable: true, publicPage: true }).map(action => [action.label, action.href])).toEqual([
    ["Editar publicación", `/empresa/vacantes/borradores/${id}`], ["Ver pipeline", `/empresa/vacantes/${id}/pipeline`], ["Ver página pública", `/vacantes/${id}`],
  ]);
  expect(portfolioRowActions(id, "published", { editable: true }).map(action => action.label)).toEqual(["Editar publicación", "Ver pipeline"]);
  expect(portfolioRowActions(id, "draft", { editable: true, publicPage: true }).map(action => action.label)).toEqual(["Continuar editando", "Publicar", "Ver pipeline"]);
  expect(hasPublicPage({ status: "published", visibility: "public" })).toBe(true);
  expect(hasPublicPage({ status: "published" })).toBe(true);
  expect(hasPublicPage({ status: "published", visibility: null })).toBe(true);
  for (const status of ["draft", "paused", "closed"] as const) expect(hasPublicPage({ status, visibility: "public" })).toBe(false);
  expect(hasPublicPage({ status: "published", visibility: "private" })).toBe(false);
  expect(["draft", "published", "paused", "closed"].map(status => isEditablePublication(status as "draft"))).toEqual([false, true, true, false]);
});

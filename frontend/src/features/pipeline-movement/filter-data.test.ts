import { expect, it } from "vitest";
import { boardSchema, detailSchema, moveSchema, participationSchema } from "./model";
import { board, detail, id, item, moved } from "./test-fixtures";
import { boardFixture } from "./board-fixture";
import { boardFilterDimensions } from "./board-filter-dimensions";
import { applyFilters, filterChips, optionCount } from "./filters";
import { applyParticipationToBoard } from "./helpers";

const profile = { city: "Ciudad de México", skills: ["Go", "Go"], years_of_experience: 0, education_level: "bachelor" as const };
const screening_answers = [{ question_id: id(23), option_id: id(24) }, { question_id: id(21), option_id: id(22) }];
const screening_filters = [{ question_id: id(21), prompt: "¿Disponible?", options: [{ id: id(25), label: "No" }, { id: id(22), label: "Sí" }] }, { question_id: id(23), prompt: "¿Viajar?", options: [{ id: id(24), label: "Sí" }] }];
const wireItem = { ...item, profile, screening_answers };
it("strict board/detail decoders require filter data and preserve catalog/snapshot order", () => {
  expect(participationSchema.parse(wireItem)).toEqual(wireItem);
  expect(detailSchema.safeParse({ ...detail, profile, screening_answers, extra: true }).success).toBe(false);
  expect(boardSchema.safeParse({ ...board, screening_filters, participations: [wireItem], extra: true }).success).toBe(false);
  expect(boardSchema.parse({ ...board, screening_filters, participations: [wireItem] }).screening_filters).toEqual(screening_filters);
  expect(detailSchema.parse({ ...detail, profile, screening_answers }).profile).toEqual(profile);
  for (const key of ["profile", "screening_answers"]) {
    expect(participationSchema.safeParse({ ...wireItem, [key]: undefined }).success).toBe(false);
    expect(detailSchema.safeParse({ ...detail, profile, screening_answers, [key]: undefined }).success).toBe(false);
  }
  expect(boardSchema.safeParse({ ...board, screening_filters: undefined }).success).toBe(false);
  for (const invalid of [
    { ...wireItem, extra: true }, { ...wireItem, screening_answers: [{ ...screening_answers[0], label: "Sí" }] },
    ...[{ ...profile, extra: true }, { ...profile, skills: [3] }, { ...profile, years_of_experience: -1 }, { ...profile, years_of_experience: 0.5 }, { ...profile, education_level: "other" }, { ...profile, city: undefined }].map(profile => ({ ...wireItem, profile })),
  ]) expect(participationSchema.safeParse(invalid).success).toBe(false);
  for (const invalid of [
    [{ ...screening_filters[0], score: 2 }],
    [{ ...screening_filters[0], options: [{ ...screening_filters[0].options[0], correct: true }] }],
  ]) expect(boardSchema.safeParse({ ...board, screening_filters: invalid, participations: [wireItem] }).success).toBe(false);
  expect(participationSchema.safeParse({ ...wireItem, profile: { city: null, skills: [], years_of_experience: null, education_level: null }, screening_answers: [] }).success).toBe(true);
});
it("all mutation decoders exclude read-only fields and applying a result preserves them", () => {
  const mutation = moveSchema.parse(moved);
  expect(mutation).not.toHaveProperty("profile");
  expect(mutation).not.toHaveProperty("screening_answers");
  for (const extra of [{ profile }, { screening_answers }]) expect(moveSchema.safeParse({ ...moved, ...extra }).success).toBe(false);
  const current = boardSchema.parse({ ...board, screening_filters, participations: [wireItem] });
  const after = applyParticipationToBoard(current, mutation);
  expect(after.participations[0]).toMatchObject({ profile, screening_answers, stage_id: moved.stage_id });
  expect(current.participations[0].stage_id).toBe(item.stage_id);
});
function filterBoard() {
  const board = boardFixture();
  board.screening_filters = [{ question_id: "q", prompt: "¿Disponible?", options: [{ id: "yes", label: "Sí" }, { id: "no", label: "No" }] }];
  board.participations = [0, 1, 3, 5, null].map((years, index) => ({ ...board.participations[0], id: String(index),
    profile: { city: index === 4 ? null : index === 0 ? "  MÉXICO   centro " : "méxico centro", skills: index === 4 ? [] : index === 0 ? [" Go ", " SQL "] : ["go"], years_of_experience: years, education_level: index === 4 ? null : "bachelor" },
    screening_answers: index === 4 ? [] : [{ question_id: "q", option_id: index === 3 ? "removed" : index === 0 ? "no" : "yes" }],
  }));
  return board;
}
it("profile options normalize, deduplicate, sort and retain first labels; buckets are half-open", () => {
  const board = filterBoard();
  board.participations[1].profile.city = "Álamo";
  const dimensions = boardFilterDimensions(board);
  const dimension = (key: string) => dimensions.find(d => d.key === key)!;
  expect(dimension("city").options).toEqual([{ value: "álamo", label: "Álamo" }, { value: "méxico centro", label: "MÉXICO centro" }, { value: "none", label: "Sin dato" }]);
  expect(dimension("skills").options).toEqual([{ value: "go", label: "Go" }, { value: "sql", label: "SQL" }, { value: "none", label: "Sin dato" }]);
  expect(dimension("experience").options.map(o => o.label)).toEqual(["Menos de 1 año", "1 a 3 años", "3 a 5 años", "5 años o más", "Sin dato"]);
  for (const [index, option] of dimension("experience").options.entries()) expect(board.participations.filter(p => dimension("experience").match(p, new Set([option.value]))).map(p => p.id)).toEqual([String(index)]);
  expect(dimension("education").options).toEqual([{ value: "bachelor", label: "Licenciatura" }, { value: "none", label: "Sin dato" }]);
  expect(optionCount(board.participations, dimension("skills"), "go")).toBe(4);
  expect(filterChips(dimensions, { skills: new Set(["sql"]) })[0].label).toBe("Habilidades: SQL");
  expect(applyFilters(board.participations, dimensions, { skills: new Set(["sql", "go"]), city: new Set(["álamo"]) }).map(p => p.id)).toEqual(["1"]);
  for (const key of ["city", "skills", "education", "experience"]) expect(applyFilters(board.participations, dimensions, { [key]: new Set(["none"]) }).map(p => p.id)).toEqual(["4"]);
});
it("casefolds Unicode labels without changing first-seen spelling", () => {
  const board = boardFixture();
  board.participations = ["Straße", "STRASSE", "Σ", "ς"].map(city => ({ ...board.participations[0], profile: { ...board.participations[0].profile, city } }));
  const city = boardFilterDimensions(board).find(d => d.key === "city")!;
  expect(city.options).toEqual([{ value: "strasse", label: "Straße" }, { value: "σ", label: "Σ" }, { value: "none", label: "Sin dato" }]);
  expect(optionCount(board.participations, city, "strasse")).toBe(2);
  expect(optionCount(board.participations, city, "σ")).toBe(2);
});
it("empty profile values use none and education follows its canonical order", () => {
  const board = boardFixture();
  board.participations = (["phd", "master", "bachelor", "high_school"] as const).map(education_level => ({ ...board.participations[0], profile: { city: "\u0085  ", skills: ["\t", " "], years_of_experience: null, education_level } }));
  const dimensions = boardFilterDimensions(board);
  expect(dimensions.find(d => d.key === "education")?.options.map(o => o.label)).toEqual(["Preparatoria", "Licenciatura", "Maestría", "Doctorado", "Sin dato"]);
  for (const key of ["city", "skills", "experience"]) {
    const dimension = dimensions.find(d => d.key === key)!;
    expect(dimension.options).toEqual([{ value: "none", label: "Sin dato" }]);
    expect(optionCount(board.participations, dimension, "none")).toBe(4);
  }
});
it("screening follows catalog order, missing answers match none, removed options match nothing", () => {
  const board = filterBoard(); const dimensions = boardFilterDimensions(board);
  const question = dimensions.find(d => d.label === "¿Disponible?")!;
  expect(question.options.map(o => o.value)).toEqual(["yes", "no", "none"]);
  expect(question.options.at(-1)?.label).toBe("Sin respuesta");
  expect(optionCount(board.participations, question, "none")).toBe(1);
  expect(question.match(board.participations[3], new Set(["removed", "yes", "no", "none"]))).toBe(false);
  const removedQuestion = { ...board.participations[0], screening_answers: [{ question_id: "retired", option_id: "yes" }] };
  expect(question.match(removedQuestion, new Set(["yes"]))).toBe(false);
  expect(question.match(removedQuestion, new Set(["none"]))).toBe(true);
  board.screening_filters = [];
  expect(boardFilterDimensions(board).some(d => d.presentation?.section.key === "screening")).toBe(false);
  expect(applyFilters(board.participations, dimensions, { [question.key]: new Set(["yes", "no"]), skills: new Set(["sql"]) }).map(p => p.id)).toEqual(["0"]);
});

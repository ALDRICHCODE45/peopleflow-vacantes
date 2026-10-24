import { expect, it } from "vitest";
import { boardSchema, detailSchema, moveSchema, participationSchema } from "./model";
import { board, detail, id, item, moved } from "./test-fixtures";
import { boardFixture } from "./board-fixture";
import { boardFilterDimensions } from "./board-filter-dimensions";
import { applyFilters, filterChips, optionCount } from "./filters";
import { applyParticipationToBoard } from "./helpers";

const location = { country: { id: "MX", name: "México" }, state: { id: "14", name: "Jalisco" }, municipality: { id: "14039", name: "Guadalajara" }, postal_code: null, label: "Guadalajara, Jalisco" };
const profile = { location, skills: ["Go", "Go"], years_of_experience: "0", seniority: null, education: { highest_completed: "bachelor" as const, in_progress: null }, languages: [] };
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
    ...[{ ...profile, extra: true }, { ...profile, skills: [3] }, { ...profile, years_of_experience: -1 }, { ...profile, years_of_experience: 0.5 }, { ...profile, education_level: "other" }, { ...profile, location: undefined }, { ...profile, city: null }, ...[{ ...location, postal_code: "44100" }, { ...location, label: undefined }, { ...location, country: { ...location.country, extra: true } }, { ...location, extra: true }].map(location => ({ ...profile, location }))].map(profile => ({ ...wireItem, profile })),
  ]) expect(participationSchema.safeParse(invalid).success).toBe(false);
  for (const invalid of [
    [{ ...screening_filters[0], score: 2 }],
    [{ ...screening_filters[0], options: [{ ...screening_filters[0].options[0], correct: true }] }],
  ]) expect(boardSchema.safeParse({ ...board, screening_filters: invalid, participations: [wireItem] }).success).toBe(false);
  expect(participationSchema.safeParse({ ...wireItem, profile: { location: null, skills: [], years_of_experience: null, seniority: null, education: { highest_completed: null, in_progress: null }, languages: [] }, screening_answers: [] }).success).toBe(true);
});
it("country-only and state-only reads retain exact locations and missing subdivisions filter as none", () => {
  const locations = [null, { ...location, state: null, municipality: null, label: "México" }, { ...location, municipality: null, label: "Jalisco" }, location];
  const current = boardFixture();
  current.participations = locations.map((location, index) => ({ ...current.participations[0], id: String(index), profile: { ...profile, location } }));
  for (const location of locations) {
    expect(detailSchema.parse({ ...detail, profile: { ...profile, location } }).profile.location).toEqual(location);
    expect(boardSchema.parse({ ...board, participations: [{ ...wireItem, profile: { ...profile, location } }] }).participations[0].profile.location).toEqual(location);
  }
  const dimensions = boardFilterDimensions(current);
  expect(applyFilters(current.participations, dimensions, { state: new Set(["none"]) }).map(p => p.id)).toEqual(["0", "1"]);
  expect(applyFilters(current.participations, dimensions, { municipality: new Set(["none"]) }).map(p => p.id)).toEqual(["0", "1", "2"]);
  expect(filterChips(dimensions, { municipality: new Set(["14039"]) })[0].label).toBe("Municipio: Guadalajara, Jalisco");
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
    profile: { location: index === 4 ? null : location, skills: index === 4 ? [] : index === 0 ? [" Go ", " SQL "] : ["go"], years_of_experience: years === null ? null : String(years), seniority: null, education: { highest_completed: index === 4 ? null : "bachelor", in_progress: null }, languages: [] },
    screening_answers: index === 4 ? [] : [{ question_id: "q", option_id: index === 3 ? "removed" : index === 0 ? "no" : "yes" }],
  }));
  return board;
}
it("profile options normalize, deduplicate, sort and retain first labels; buckets are half-open", () => {
  const board = filterBoard();
  board.participations[1].profile.location = { ...location, state: { id: "01", name: "Aguascalientes" }, municipality: { id: "01001", name: "Guadalajara" } };
  const dimensions = boardFilterDimensions(board);
  const dimension = (key: string) => dimensions.find(d => d.key === key)!;
  expect(dimension("state").options).toEqual([{ value: "01", label: "Aguascalientes" }, { value: "14", label: "Jalisco" }, { value: "none", label: "Sin dato" }]);
  expect(dimension("municipality").options).toEqual([{ value: "01001", label: "Guadalajara, Aguascalientes" }, { value: "14039", label: "Guadalajara, Jalisco" }, { value: "none", label: "Sin dato" }]);
  expect(dimensions.some(d => d.key === "city")).toBe(false);
  expect(dimension("skills").options).toEqual([{ value: "go", label: "Go" }, { value: "sql", label: "SQL" }, { value: "none", label: "Sin dato" }]);
  expect(dimension("experience").options.map(o => o.label)).toEqual(["Menos de 1 año", "1 a 3 años", "3 a 5 años", "5 años o más", "Sin dato"]);
  for (const [index, option] of dimension("experience").options.entries()) expect(board.participations.filter(p => dimension("experience").match(p, new Set([option.value]))).map(p => p.id)).toEqual([String(index)]);
  expect(dimension("education").options.map(option => option.value)).toEqual(["secondary", "high_school", "technical", "tsu", "bachelor", "specialty", "master", "phd", "none"]);
  expect(optionCount(board.participations, dimension("skills"), "go")).toBe(4);
  expect(filterChips(dimensions, { skills: new Set(["sql"]) })[0].label).toBe("Habilidades: SQL");
  expect(applyFilters(board.participations, dimensions, { skills: new Set(["sql", "go"]), state: new Set(["01", "14"]), municipality: new Set(["01001"]) }).map(p => p.id)).toEqual(["1"]);
  for (const key of ["state", "municipality", "skills", "education", "experience"]) expect(applyFilters(board.participations, dimensions, { [key]: new Set(["none"]) }).map(p => p.id)).toEqual(["4"]);
});
it("casefolds Unicode labels without changing first-seen spelling", () => {
  const board = boardFixture();
  board.participations = ["Straße", "STRASSE", "Σ", "ς"].map(skill => ({ ...board.participations[0], profile: { ...board.participations[0].profile, skills: [skill] } }));
  const skills = boardFilterDimensions(board).find(d => d.key === "skills")!;
  expect(skills.options).toEqual([{ value: "strasse", label: "Straße" }, { value: "σ", label: "Σ" }, { value: "none", label: "Sin dato" }]);
  expect(optionCount(board.participations, skills, "strasse")).toBe(2);
  expect(optionCount(board.participations, skills, "σ")).toBe(2);
});
it("matches skills stored as typed and legacy lowercase skills alike (S4d)", () => {
  for (const order of [["React", "react"], ["react", "React"]]) {
    const board = boardFixture();
    board.participations = order.map((skill, index) => ({ ...board.participations[0], id: String(index + 1), profile: { ...board.participations[0].profile, skills: [skill] } }));
    const dimensions = boardFilterDimensions(board);
    const skills = dimensions.find(d => d.key === "skills")!;
    expect(skills.options).toEqual([{ value: "react", label: order[0] }, { value: "none", label: "Sin dato" }]);
    expect(applyFilters(board.participations, dimensions, { skills: new Set(["react"]) }).map(p => p.id)).toEqual(["1", "2"]);
  }
});
it("empty profile values use none and education follows its canonical order", () => {
  const board = boardFixture();
  board.participations = (["phd", "master", "bachelor", "high_school"] as const).map(education_level => ({ ...board.participations[0], profile: { location: null, skills: ["\t", " "], years_of_experience: null, seniority: null, education: { highest_completed: education_level, in_progress: null }, languages: [] } }));
  const dimensions = boardFilterDimensions(board);
  expect(dimensions.find(d => d.key === "education")?.options.map(o => o.value)).toEqual(["secondary", "high_school", "technical", "tsu", "bachelor", "specialty", "master", "phd", "none"]);
  for (const key of ["state", "municipality", "skills", "experience"]) {
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

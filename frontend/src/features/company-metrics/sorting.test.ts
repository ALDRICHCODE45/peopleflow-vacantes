import { expect, it } from "vitest";
import { nextSort, sortLabel, sortRecruiters, type RecruiterSort } from "./sorting";
import { andrea, card, carlos, fernanda } from "./test-fixtures";

// Input in the backend order (§3.7.11).
const names = (sort: RecruiterSort) => sortRecruiters([andrea(), carlos(), fernanda(), card()], sort).map(item => item.name);

it("keeps the backend's default order (lowercase name, null names last) instead of re-sorting it", () => {
  const server = [card({ user_id: "a", name: "alberto" }), card({ user_id: "z", name: "Zoe" }), card({ user_id: "á", name: "Ángela" }), card({ user_id: "n", name: null })];
  expect(sortRecruiters(server, { key: "name", direction: "ascending" }).map(item => item.name)).toEqual(["alberto", "Zoe", "Ángela", null]);
  expect(sortRecruiters(server, { key: "name", direction: "descending" }).map(item => item.name)).toEqual(["Ángela", "Zoe", "alberto", null]);
  expect(names({ key: "name", direction: "ascending" })).toEqual(["Andrea Villalobos", "Carlos Mendoza Ruiz", "Fernanda Ortiz", "Mariana Torres"]);
});

it("keeps rows without a sample last in both directions", () => {
  expect(names({ key: "conversion", direction: "descending" })).toEqual(["Andrea Villalobos", "Mariana Torres", "Carlos Mendoza Ruiz", "Fernanda Ortiz"]);
  expect(names({ key: "conversion", direction: "ascending" })).toEqual(["Carlos Mendoza Ruiz", "Mariana Torres", "Andrea Villalobos", "Fernanda Ortiz"]);
  expect(names({ key: "median", direction: "ascending" }).at(-1)).toBe("Fernanda Ortiz");
  expect(names({ key: "median", direction: "descending" }).at(-1)).toBe("Fernanda Ortiz");
});

it("breaks ties by name, ascending, whatever the direction", () => {
  // Andrea and Fernanda both received 1 reassignment.
  expect(names({ key: "reassignments", direction: "descending" })).toEqual(["Mariana Torres", "Andrea Villalobos", "Fernanda Ortiz", "Carlos Mendoza Ruiz"]);
  expect(names({ key: "reassignments", direction: "ascending" })).toEqual(["Carlos Mendoza Ruiz", "Andrea Villalobos", "Fernanda Ortiz", "Mariana Torres"]);
});

// S3: «Entregas a tiempo» shows the percentage and «N de M»; the order follows the percentage, the count breaks a tie.
it("sorts «Entregas a tiempo» by the percentage, then by the count, rows without a sample last", () => {
  const rate = (user_id: string, name: string, on_time: number, late: number) => card({ user_id, name, delivery: { ...card().delivery, on_time, late, overdue: 0 } });
  // 3 de 3 = 100 %, 6 de 8 = 75 %, 2 de 4 = 50 %, 1 de 2 = 50 %, nobody judged = no sample.
  const items = [rate("a", "Ana", 6, 2), rate("b", "Beto", 3, 0), rate("c", "Cris", 1, 1), rate("d", "Dani", 2, 2), fernanda()];
  const order = (direction: RecruiterSort["direction"]) => sortRecruiters(items, { key: "on_time", direction }).map(item => item.name);
  expect(order("descending")).toEqual(["Beto", "Ana", "Dani", "Cris", "Fernanda Ortiz"]);
  expect(order("ascending")).toEqual(["Cris", "Dani", "Ana", "Beto", "Fernanda Ortiz"]);
});

it("sorts placements by their total, never adding did_not_hold", () => {
  expect(names({ key: "placements", direction: "descending" })).toEqual(["Mariana Torres", "Andrea Villalobos", "Carlos Mendoza Ruiz", "Fernanda Ortiz"]);
});

it("toggles a column ascending then descending and names the order", () => {
  expect(nextSort({ key: "name", direction: "ascending" }, "name")).toEqual({ key: "name", direction: "descending" });
  expect(nextSort({ key: "name", direction: "descending" }, "assigned")).toEqual({ key: "assigned", direction: "ascending" });
  expect(sortLabel({ key: "name", direction: "ascending" })).toBe("Orden: nombre (A–Z)");
  expect(sortLabel({ key: "conversion", direction: "descending" })).toBe("Orden: conversión (mayor a menor)");
});

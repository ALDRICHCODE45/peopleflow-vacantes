import { expect, it } from "vitest";
import { nextSort, sortLabel, sortRecruiters, type RecruiterSort } from "./sorting";
import { andrea, card, carlos, fernanda } from "./test-fixtures";

const names = (sort: RecruiterSort) => sortRecruiters([card(), carlos(), fernanda(), andrea()], sort).map(item => item.name);

it("orders alphabetically by default, with accents compared as Spanish", () => {
  expect(names({ key: "name", direction: "ascending" })).toEqual(["Andrea Villalobos", "Carlos Mendoza Ruiz", "Fernanda Ortiz", "Mariana Torres"]);
  expect(names({ key: "name", direction: "descending" })).toEqual(["Mariana Torres", "Fernanda Ortiz", "Carlos Mendoza Ruiz", "Andrea Villalobos"]);
});

it("keeps rows without a sample last in both directions", () => {
  expect(names({ key: "conversion", direction: "descending" })).toEqual(["Andrea Villalobos", "Mariana Torres", "Carlos Mendoza Ruiz", "Fernanda Ortiz"]);
  expect(names({ key: "conversion", direction: "ascending" })).toEqual(["Carlos Mendoza Ruiz", "Mariana Torres", "Andrea Villalobos", "Fernanda Ortiz"]);
  expect(names({ key: "median", direction: "ascending" }).at(-1)).toBe("Fernanda Ortiz");
  expect(names({ key: "median", direction: "descending" }).at(-1)).toBe("Fernanda Ortiz");
});

it("breaks ties by name, ascending, whatever the direction", () => {
  // Mariana and Andrea both have 6 on time.
  expect(names({ key: "on_time", direction: "descending" })).toEqual(["Andrea Villalobos", "Mariana Torres", "Carlos Mendoza Ruiz", "Fernanda Ortiz"]);
  expect(names({ key: "on_time", direction: "ascending" })).toEqual(["Fernanda Ortiz", "Carlos Mendoza Ruiz", "Andrea Villalobos", "Mariana Torres"]);
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

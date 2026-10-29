import { describe, it, expect } from "vitest";
import { item, id, detail } from "@/features/pipeline-movement/test-fixtures";
import type { Checklist, Mark } from "../model";
import { buildComparison } from "./model";
import { comparisonCsv } from "./csv";
export const checklist: Checklist = { version: "1", reminder_stage_ids: [], criteria: [
  { id: id(30), label: "Entrevista", importance: "desirable", kind: "manual", params: {} },
  { id: id(31), label: "SQL", importance: "required", kind: "skill", params: { name: "SQL" } },
] };
export const people = [item, { ...item, id: id(15), candidate: { ...item.candidate, full_name: "Bea" }, profile: { ...item.profile, skills: ["SQL"] } }];
export const marks: Mark[] = [{ participation_id: item.id, criterion_id: id(30), verdict: "not_met", note: 'Nota, "larga"\nsegunda línea', marked_by: { id: id(40), full_name: "Reclutador" }, marked_at: "2026-10-28T12:00:00Z" }];
describe("comparison model", () => {
 it("orders by fit, groups required first and keeps results, source and notes", () => {
  const m = buildComparison(checklist, marks, people, [item.id, id(15)]);
  expect(m.candidates.map(c => c.name)).toEqual(["Bea", "Ana Pérez"]);
  expect(m.groups.map(g => g.label)).toEqual(["Obligatorios", "Deseables"]);
  expect(m.groups[0].rows[0].cells[0]).toMatchObject({ result: "met", source: "perfil", note: null });
  expect(m.groups[1].rows[0].cells[1]).toMatchObject({ result: "not_met", source: "reclutador", note: marks[0].note });
  expect(m.groups[1].rows[0].cells[0]).toMatchObject({ result: "unknown", source: null });
 });
 it("reports unknown/foreign ids, deduplicates and preserves board order on ties", () => {
  const m = buildComparison(checklist, [], [item, { ...item, id: id(15) }], [id(15), item.id, item.id, id(99)]);
  expect(m.invalidIds).toEqual([id(99)]);
  expect(m.candidates.map(c => c.id)).toEqual([item.id, id(15)]);
 });
 it("handles empty criteria and selection", () => {
  expect(buildComparison({ ...checklist, criteria: [] }, [], people, []).groups).toEqual([]);
  expect(buildComparison(checklist, [], people, []).candidates).toEqual([]);
 });
});
describe("comparison CSV", () => {
 it("has BOM, CRLF, headers, quoted notes and no contact fields", () => {
  const csv = comparisonCsv(buildComparison(checklist, marks, [detail, people[1]], people.map(p => p.id)), "Desarrollo", "Empresa", "28 oct 2026");
  expect(csv.startsWith('\uFEFF"Vacante"')).toBe(true);
  expect(csv).toContain('"Candidato","Etapa","Ajuste","Importancia","Criterio","Resultado","Fuente","Nota del reclutador"');
  expect(csv).toContain('"Nota, ""larga""\nsegunda línea"');
  expect(csv.endsWith("\r\n")).toBe(true);
  expect(csv).toContain('"sin evaluar","",""');
  expect(csv).not.toContain("Sin fuente");
  expect(csv).not.toMatch(/Email|Teléfono|email|phone|ana@example.com/);
 });
 it.each(["=SUM(1)", "+cmd", "@x", "-1", "\t =1"])("neutralizes formulas in all free text: %s", value => {
  const list = { ...checklist, criteria: [{ ...checklist.criteria[0], label: value }] };
  const csv = comparisonCsv(buildComparison(list, [], people, people.map(p => p.id)), value, value, value);
  expect(csv).toContain(`"'${value}"`);
  expect(csv).not.toContain(`,"${value}"`);
 });
});

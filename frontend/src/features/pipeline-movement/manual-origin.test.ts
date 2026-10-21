import { expect, it } from "vitest";
import { participationSchema, detailSchema, moveSchema } from "./model";
import { item, moved, detail, id } from "./test-fixtures";

const origin = { source: "manual", added_by: { id: id(99), name: "Luis López" }, candidate: { ...item.candidate, kind: "manual" } };
it.each([[participationSchema, item], [detailSchema, detail], [moveSchema, moved]] as const)("accepts strict manual origin on every read/write response %#", (schema, fixture) => {
  expect(schema.safeParse({ ...fixture, ...origin }).success).toBe(true);
  for (const key of ["source", "added_by", "candidate"] as const) {
    const value: Record<string, unknown> = { ...fixture, ...origin }; delete value[key];
    expect(schema.safeParse(value).success).toBe(false);
  }
  expect(schema.safeParse({ ...fixture, ...origin, candidate: { ...origin.candidate, kind: "unknown" } }).success).toBe(false);
  expect(schema.safeParse({ ...fixture, ...origin, candidate: { id: id(11), full_name: "Ana" } }).success).toBe(false);
  expect(schema.safeParse({ ...fixture, source: "organic", added_by: null, candidate: { ...origin.candidate, kind: "organic" } }).success).toBe(true);
  expect(schema.safeParse({ ...fixture, ...origin, added_by: { ...origin.added_by, extra: true } }).success).toBe(false);
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { normalizeSkills, parseSkills } from "./skills";

// User (S4d): skills keep the typed casing; duplicates stay case-insensitive.
it("keeps the typed casing and drops empty entries", () => {
  expect(normalizeSkills([" React ", "TypeScript", "", "  ", "SQL"])).toEqual(["React", "TypeScript", "SQL"]);
});

it("dedupes case-insensitively keeping the first occurrence", () => {
  expect(normalizeSkills(["React", "react", "REACT", "Node.js", "node.js"])).toEqual(["React", "Node.js"]);
});

it("collapses inner whitespace", () => {
  expect(normalizeSkills(["Atención   a clientes"])).toEqual(["Atención a clientes"]);
});

it("splits comma and line separated text", () => {
  expect(parseSkills("React, TypeScript\nSQL, react")).toEqual(["React", "TypeScript", "SQL"]);
});

it.each(["features/manual-intake/draft.ts", "features/org-candidates/edit/edit-draft.ts", "features/candidate/model.ts"])(
  "%s normalizes skills through the shared helper",
  (file) => {
    const source = readFileSync(join(process.cwd(), "src", file), "utf8");
    expect(source).toContain('from "@/lib/skills"');
    expect(source).not.toMatch(/skill[^\n]*toLowerCase|value\.trim\(\)\.toLowerCase\(\)\)\.filter/u);
  },
);

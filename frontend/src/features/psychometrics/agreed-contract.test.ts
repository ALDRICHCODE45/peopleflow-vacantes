import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { COMPETENCY_IDS, FACET_IDS, ERROR_CODES, bandSchema, importanceSchema, fitSchema, tierSchema, signalIdSchema } from "./model";
const doc = (name: string) => readFileSync(resolve(process.cwd(), "..", name), "utf8");
const contract = doc("docs/contracts/psychometric-tests-v1.md");
it("uses the backend-agreed v1 contract, not a draft substitute", () => {
  expect(contract).toMatch(/Status: \*\*agreed with the backend/);
  for (const phrase of ["ipip60-mx", "psychometrics.content.v1", "psychometrics.scoring.v1", "/v2/assessments/{token}", "/v2/me/assessments/{iid}", "DELETE {base}/answers/{position}", "Retry-After"]) expect(contract).toContain(phrase);
});
it("matches every contract error table code exactly", () => {
  const table = contract.split("## Error codes")[1].split("## Employer endpoints")[0];
  expect([...table.matchAll(/^\| `([^`]+)` \|/gm)].map(m => m[1]).sort()).toEqual([...ERROR_CODES, "not_found"].sort()); // not_found: existing catalog code listed for the position rule
});
it("uses canonical catalog ids without aliases", () => {
  const bands = doc("docs/psychometrics/bands-and-competencies-v1.md");
  const signals = doc("docs/psychometrics/quality-signals-v1.md");
  const items = doc("docs/psychometrics/item-bank-v1.md");
  for (const id of [...COMPETENCY_IDS, ...bandSchema.options, ...importanceSchema.options, ...fitSchema.options]) expect(bands).toContain(id);
  for (const id of [...tierSchema.options, ...signalIdSchema.options]) expect(signals).toContain(id);
  for (const id of FACET_IDS) expect(items).toContain(id);
  expect([...new Set(bands.match(/comp\.[a-z]+/g))].sort()).toEqual([...COMPETENCY_IDS].sort());
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { candidateBaseSchema, candidateItemsSchema, resultSchema } from "./model";
import { base, items, result } from "./fixtures.test";
const source = (name: string) => readFileSync(resolve(process.cwd(), "src/features/psychometrics", name), "utf8");
it("keeps transport server-only, credentials guarded, redirects rejected and public URLs unlogged", () => {
  const client = source("client.ts");
  expect(client).toContain('import "server-only"'); expect(client).toContain('from "@/lib/api/server"');
  expect(client).toContain('url.origin !== origin.origin'); expect(client).toContain('redirect: "error"'); expect(client).toContain('cache: "no-store"'); expect(client).toContain('credentials: "omit"'); expect(client).toContain('referrerPolicy: "no-referrer"');
  expect(client).not.toMatch(/console\.|logger\.|throw new Error/);
  const actions = source("actions.ts"); expect(actions).toContain('"use server"'); expect(actions).not.toMatch(/\bfetch\(|lib\/api\//);
});
it("keeps candidate shapes free of scores, keys, facets, quality and employer result data", () => {
  for (const key of ["result", "score", "facets", "key", "quality", "latest_comparison"]) {
    expect(candidateBaseSchema.safeParse({ ...base, [key]: result }).success).toBe(false);
    expect(candidateItemsSchema.safeParse({ ...items, items: items.items.map(i => ({ ...i, [key]: true })) }).success).toBe(false);
  }
});
it("never accepts overall fit, hiring verdicts or live interpretation lookups in a result", () => {
  for (const key of ["overall_fit", "percentile", "apto", "auto_reject"]) expect(resultSchema.safeParse({ ...result, [key]: true }).success).toBe(false);
  expect(source("model.ts")).not.toMatch(/from ["'].*(?:item-bank|interpretation-library|interview-bank)/);
});

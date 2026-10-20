import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// User decision (2026-10-19): «quiero que todos los calendarios que se ocupen en este sistema
// (calendarios de shadcn) tengan la prop captionLayout en dropdown». Rule: frontend-ui-design-rules.
const SRC = join(process.cwd(), "src");
function productionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return productionFiles(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

it("renders every Calendar with month and year dropdowns", () => {
  const usages = productionFiles(SRC).flatMap(file => {
    const source = readFileSync(file, "utf8");
    return [...source.matchAll(/<Calendar\b[\s\S]*?\/?>/g)].map(match => ({ file: file.slice(SRC.length + 1), tag: match[0] }));
  });
  expect(usages.length).toBeGreaterThan(0);
  for (const usage of usages) expect(usage.tag, usage.file).toContain('captionLayout="dropdown"');
});

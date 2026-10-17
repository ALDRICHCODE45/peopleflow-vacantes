import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
const sources = ["features/candidate-applications/wizard.tsx", "features/candidate-applications/cv-picker.tsx", "features/candidate/applications-workspace.tsx"];
it.each(sources)("keeps %s on installed primitives and semantic tokens (§9 source audit)", path => {
  const source = readFileSync(join(process.cwd(), "src", path), "utf8");
  expect(source).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|color-mix\(|(?:bg|text|border)-(?:red|blue|gray|slate|zinc|violet)-\d|dark:|space-[xy]-|style=|animate-pulse|<input\b|<textarea\b|<button\b|<hr\b|<Alert\b/);
  expect(source).toContain("notifyActionResult");
  expect(source).toContain("ActionBar");
  expect(source).toContain("ActionStatus");
  expect(source).toContain("min-h-10");
});
it("keeps semantic lifecycle badges and no local status palette", () => {
  const source = readFileSync(join(process.cwd(), "src/features/candidate/applications-workspace.tsx"), "utf8");
  expect(source).toContain('<Badge variant="info" dot>Postulación enviada</Badge>');
  expect(source).not.toMatch(/prototype-|in_review|hired|rejected|coverLetter/);
});

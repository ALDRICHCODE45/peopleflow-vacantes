import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
const read = (path: string) => readFileSync(join(process.cwd(), "src", path), "utf8");
const onboarding = read("features/identity/onboarding.tsx");
const states = read("features/identity/identity-states.tsx");
const login = read("components/auth/CandidateAuthControls.tsx");
const nav = read("components/candidate-dashboard/candidate-nav-user.tsx");
describe("candidate identity UI rules §9/§11–13", () => {
  it("composes installed primitives without raw paint or local animation substitutes", () => {
    for (const source of [onboarding, states, login, nav]) {
      expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|dark:|space-[xy]-|animate-pulse|<Alert/);
      expect(source).not.toMatch(/from ["']sileo["']|<Toaster/);
    }
    expect(states).toContain("<Skeleton"); expect(onboarding).toContain("<Spinner");
  });
  it("uses real headings, field errors, and one primary action in the compact CardFooter", () => {
    expect(onboarding).toContain("<h2");
    expect(onboarding).toContain("<FieldGroup>"); expect(onboarding).toContain("<FieldError");
    const footer = onboarding.slice(onboarding.indexOf("<CardFooter"), onboarding.indexOf("</CardFooter>"));
    expect(footer).toContain("<ActionBar status={status}>");
    expect(footer.match(/<Button\b/g)).toHaveLength(1);
    expect(footer).not.toContain("flex-col");
    expect(footer).toContain("aria-describedby=");
    expect(footer).toContain("min-h-10");
  });
  it("keeps action results in the global notifier and a persistent status slot", () => {
    for (const source of [onboarding, login, nav]) {
      expect(source).toContain("notifyActionResult"); expect(source).toContain("<ActionStatus");
    }
    expect(states).toContain("aria-busy=\"true\"");
    expect(states).toContain("aria-hidden=\"true\"");
  });
});

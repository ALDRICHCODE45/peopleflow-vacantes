import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import {
  PROTOTYPE_DISCLOSURE,
  PrototypeDisclosure,
  VerifiedByPeopleFlow,
  CompanyMonogram,
  companyInitials,
  prototypeApplicantsLabel,
  prototypeResponseLabel,
} from "./prototype-ui";

const source = readFileSync(join(process.cwd(), "src", "features", "jobs", "components", "prototype-ui.tsx"), "utf8");
/** Every literal color this token-only module must never carry. */
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|color-mix)\(/u;

describe("companyInitials", () => {
  it("builds a one or two mark initials string from any company name", () => {
    expect(companyInitials("Acme")).toBe("Ac");
    expect(companyInitials("Orbital")).toBe("Or");
    expect(companyInitials("Acme Technologies")).toBe("AT");
    expect(companyInitials("Nimbus Labs")).toBe("NL");
    expect(companyInitials("Consultoría Integral de Ingeniería de Software")).toBe("CS");
  });
  it("normalizes surrounding space and casing without dropping accented letters", () => {
    expect(companyInitials("  nimbus   labs  ")).toBe("NL");
    expect(companyInitials("Óptica Ávila")).toBe("ÓÁ");
    expect(companyInitials("óptica")).toBe("Óp");
  });
  it("walks code points, so a surrogate pair is never split or duplicated", () => {
    expect(Array.from(companyInitials("🚀 Logistics"))).toHaveLength(2);
    expect(companyInitials("🚀 Logistics")).toBe("🚀L");
    expect([companyInitials("𝔸cme"), companyInitials("𝔸cme")]).toEqual(["𝔸c", "𝔸c"]);
    expect(Array.from(companyInitials("Óptica Ávila")).length).toBeLessThanOrEqual(2);
    expect(companyInitials("Consultoría Integral de Ingeniería de Software")).not.toBe("Consultoría");
  });
  it("degrades to an empty mark for a missing or blank name", () => {
    expect([companyInitials(""), companyInitials("   "), companyInitials("\n\t")]).toEqual(["", "", ""]);
  });
});

describe("prototype labels", () => {
  it("uses the Spanish singular only for exactly one applicant", () => {
    expect([0, 1, 2, 24, 41].map(prototypeApplicantsLabel)).toEqual(["0 postulantes", "1 postulante", "2 postulantes", "24 postulantes", "41 postulantes"]);
  });
  it("states the response estimate in Spanish days", () => {
    expect([1, 2, 3].map(prototypeResponseLabel)).toEqual(["Responde en ~1 día", "Responde en ~2 días", "Responde en ~3 días"]);
  });
});

describe("PROTOTYPE_DISCLOSURE", () => {
  it("is one trimmed Spanish sentence that names the demonstration boundary", () => {
    expect(PROTOTYPE_DISCLOSURE).toBe(PROTOTYPE_DISCLOSURE.trim());
    expect(PROTOTYPE_DISCLOSURE.split("\n")).toHaveLength(1);
    expect(PROTOTYPE_DISCLOSURE).toContain("demostración");
    expect(PROTOTYPE_DISCLOSURE).toContain("no se conecta a ningún backend");
    expect(PROTOTYPE_DISCLOSURE.endsWith(".")).toBe(true);
    expect(PROTOTYPE_DISCLOSURE).not.toMatch(/[—–]/u);
  });
});

describe("CompanyMonogram", () => {
  it("renders a decorative initials tile with tokenized classes only", () => {
    const { container } = render(<CompanyMonogram name="Acme Technologies" />);
    const tile = container.querySelector("span");
    expect(tile?.textContent).toBe("AT");
    expect(tile?.getAttribute("aria-hidden")).toBe("true");
    expect(tile?.className).toMatch(/from-primary/u);
    expect(tile?.className).toMatch(/to-primary\//u);
    expect(tile?.className).not.toMatch(RAW_COLOR);
  });
  it("keeps the gradient on the tile alone and offers both sizes", () => {
    const { container, rerender } = render(<CompanyMonogram name="Acme" />);
    const defaultTile = container.querySelector("span")?.className ?? "";
    rerender(<CompanyMonogram name="Acme" size="compact" />);
    const compactTile = container.querySelector("span")?.className ?? "";
    expect([container.querySelectorAll('[class*="gradient"]').length, container.querySelectorAll("[style]").length]).toEqual([1, 0]);
    expect([defaultTile.includes("size-12"), compactTile.includes("size-10"), defaultTile === compactTile]).toEqual([true, true, false]);
  });
  it("renders a blank tile instead of inventing a mark for a nameless company", () => {
    const { container } = render(<CompanyMonogram name="  " />);
    expect(container.querySelector("span")?.textContent).toBe("");
  });
});

describe("VerifiedByPeopleFlow", () => {
  it("shows the exact verification copy as a non-interactive row", () => {
    const { container } = render(<VerifiedByPeopleFlow />);
    expect(container.textContent).toBe("Verificada por PeopleFlow");
    expect(container.querySelectorAll("a, button, input, [role]")).toHaveLength(0);
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("renders a decorative shield beside text that keeps its contrast token", () => {
    const { container } = render(<VerifiedByPeopleFlow />);
    const row = container.firstElementChild as HTMLElement;
    expect([container.querySelector("svg")?.getAttribute("aria-hidden"), row.className.includes("text-muted-foreground")]).toEqual(["true", true]);
    expect([row.hasAttribute("style"), RAW_COLOR.test(row.className)]).toEqual([false, false]);
  });
});

describe("PrototypeDisclosure", () => {
  it("exposes the shared disclosure copy as a note with small text", () => {
    render(<PrototypeDisclosure />);
    const note = screen.getByRole("note");
    expect(note.textContent).toBe(PROTOTYPE_DISCLOSURE);
    expect([note.tagName, note.classList.contains("text-xs")]).toEqual(["P", true]);
  });
});

describe("prototype-ui source boundary", () => {
  it("stays a server-safe presentational module with no interactivity", () => {
    expect(source).not.toMatch(/"use client"|useState|useEffect|useRef|useMemo|useSyncExternalStore/u);
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|axios|localStorage|sessionStorage|indexedDB/u);
    expect(source).not.toMatch(/onClick|onChange|<button|<a\b|href=/u);
    expect(source).not.toMatch(/style=\{\{|dangerouslySetInnerHTML/u);
    expect(source).not.toMatch(RAW_COLOR);
  });
  it("imports the icon set and nothing else", () => {
    expect([...source.matchAll(/from "([^"]+)"/gu)].map((match) => match[1])).toEqual(["lucide-react"]);
  });
});

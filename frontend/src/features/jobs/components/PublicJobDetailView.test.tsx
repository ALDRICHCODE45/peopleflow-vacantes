import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vacancyDetail } from "../api/public-fixtures";
import { PublicJobDetailView } from "./PublicJobDetailView";

afterEach(cleanup);
// Vitest runs from frontend/, so cwd-relative paths keep the assertions stable.
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const block = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start, `expected a ${selector} block in globals.css`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
};

it("fades the section nav at the edge where tabs are hidden instead of cutting «Beneficios» at 390 px", () => {
  render(<PublicJobDetailView job={vacancyDetail} />);
  const nav = screen.getByRole("navigation", { name: "Secciones de la vacante" });
  expect(nav).toHaveClass("pf-job-section-nav");
  expect(Array.from(nav.querySelectorAll("a")).map(link => link.textContent)).toContain("Beneficios");
  const rule = block(".pf-job-section-nav");
  // Scroll-linked fades: none while everything fits, the hidden edge fades while scrolling.
  expect(rule).toMatch(/mask-image:\s*linear-gradient\(\s*to right,[^;]*var\(--pf-fade-start\)[^;]*var\(--pf-fade-end\)/u);
  // The animation only exists where scroll timelines do; a 0s fill-both fallback would pin a left fade.
  expect(rule).not.toMatch(/animation/u);
  expect(css).toMatch(/@supports \(animation-timeline: scroll\(\)\)\s*\{\s*\.pf-job-section-nav\s*\{\s*animation: pf-scroll-edge-fade linear both;\s*animation-timeline: scroll\(self inline\);/u);
  // The nav rule (its 1px base line) stays unmasked.
  expect(rule).toMatch(/mask-size:\s*100% 100%,\s*100% 1px/u);
  expect(css).toMatch(/@keyframes pf-scroll-edge-fade\s*\{/u);
  expect(css).toMatch(/@property --pf-fade-start\s*\{/u);
  expect(css).toMatch(/@property --pf-fade-end\s*\{/u);
  // Browsers without scroll timelines get a static right fade with room to scroll the last tab clear of it.
  expect(css).toMatch(/@supports not \(animation-timeline: scroll\(\)\)\s*\{\s*\.pf-job-section-nav\s*\{[^}]*padding-inline-end:\s*48px;[^}]*--pf-fade-end:\s*48px;/u);
});

it("keeps the actions column tight and aligned under «Postularme»: hidden empty status slot, centred application facts", () => {
  const { container } = render(<PublicJobDetailView job={vacancyDetail} />);
  const actions = container.querySelector("[data-public-actions]")!;
  expect(actions.className).toContain("[&_[data-pf-action-status-slot]:empty]:hidden");
  const info = actions.querySelector("[data-public-application-info]")!;
  expect(info).toHaveClass("items-center");
  expect(info).toHaveTextContent("Menos de 10 postulantes");
  expect(info).toHaveTextContent("Postulación rápida");
  expect(screen.getByRole("status")).toHaveClass("empty:h-0");
});

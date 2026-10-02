import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CandidateFooter, CandidateLanding } from "./CandidateLanding";
import { EmployerLanding } from "./EmployerLanding";
import { ACME_PROTOTYPE_JOBS } from "@/features/jobs/prototype-jobs";

vi.mock("./HeroAurora", () => ({ HeroAurora: ({ audience }: { audience: string }) => <div data-aurora-audience={audience} /> }));
afterEach(cleanup);

describe("candidate marketing landing", () => {
  it("has five distinct named sections and one candidate headline", () => {
    const { container } = render(<CandidateLanding />);
    const sections = container.querySelectorAll("section[data-pf-candidate-section]");
    expect(sections).toHaveLength(5);
    expect(Array.from(sections, section => section.getAttribute("data-pf-candidate-section"))).toEqual(["hero", "discovery", "benefits", "showcase", "closing"]);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Explora. Postúlate. Avanza.");
    for (const section of sections) expect(section).toHaveAccessibleName();
    for (const id of ["soluciones", "producto", "empezar"]) expect(container.querySelector(`#${id}`)).not.toBeNull();
  });

  it("reuses employer hero geometry, diagrams, section layouts and violet CTAs", () => {
    const { container, rerender } = render(<EmployerLanding />);
    const sectionClasses = Array.from(container.querySelectorAll("section"), el => el.className);
    const nodePositions = Array.from(container.querySelectorAll(".pf-pipeline-stage > div"), el => el.getAttribute("style"));
    const heroGridClass = container.querySelector("section > div")?.className;
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Publica. Recibe. Contrata.");
    expect(container.textContent).toContain("−68%");
    expect(container.querySelector("[data-aurora-audience]")).toHaveAttribute("data-aurora-audience", "employer");
    rerender(<CandidateLanding />);
    expect(Array.from(container.querySelectorAll("section"), el => el.className)).toEqual(sectionClasses);
    expect(Array.from(container.querySelectorAll(".pf-pipeline-stage > div"), el => el.getAttribute("style"))).toEqual(nodePositions);
    expect(container.querySelector("section > div")?.className).toBe(heroGridClass);
    expect(container.querySelector(".pf-pipeline-stage svg")).toHaveAttribute("viewBox", "0 0 580 420");
    expect(container.querySelectorAll(".flow")).toHaveLength(3);
    expect(container.querySelector("animateMotion")).toHaveAttribute("dur", "5s");
    expect(container.querySelector(".pf-pipeline-stage")).toHaveTextContent("Postúlate");
    expect(container.querySelector("[data-aurora-audience]")).toHaveAttribute("data-aurora-audience", "candidate");
    expect(container.querySelectorAll(".btn-primary.bg-brand")).toHaveLength(2);
    expect(container.querySelector(".sectionWash")).toBeNull();
    expect(container.textContent).not.toMatch(/−68%|100%|Screening|Contratado|ATS · Pipeline/);
  });

  it("uses existing candidate destinations and canonical vacancy facts without false outcome claims", () => {
    const { container } = render(<CandidateLanding />);
    for (const link of screen.getAllByRole("link", { name: /explorar vacantes/i })) expect(link).toHaveAttribute("href", "/vacantes");
    for (const link of screen.getAllByRole("link", { name: /ingresar a mi perfil/i })) expect(link).toHaveAttribute("href", "/candidato/login");
    for (const job of ACME_PROTOTYPE_JOBS) {
      expect(screen.getByRole("link", { name: job.title })).toHaveAttribute("href", `/vacantes/${job.id}`);
    }
    for (const link of container.querySelectorAll("a")) expect(link.getAttribute("href")).toMatch(/^(\/vacantes(?:\/[^/]+)?|\/candidato\/login)$/);
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toMatch(/vista de ejemplo/i);
    expect(container.textContent).toContain("no son postulaciones reales");
    expect(container.textContent).not.toMatch(/empleo garantizado|contratación garantizada|miles de empresas|matching con IA/i);
  });

  it("keeps footer links real and future actions enabled, inert and clearly labelled", () => {
    const { container } = render(<CandidateFooter />);
    expect(screen.getByRole("link", { name: "Para empresas" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Ingresar a mi perfil" })).toHaveAttribute("href", "/candidato/login");
    expect(screen.getByRole("link", { name: "PeopleFlow" })).toHaveAttribute("href", "/candidatos");
    for (const link of container.querySelectorAll("a")) expect(link.getAttribute("href")).toMatch(/^(\/vacantes|\/candidato\/login|\/candidatos|\/|#soluciones|#producto|#empezar)$/);
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeEnabled();
      expect(button).toHaveAccessibleName(/próximamente/);
    }
  });
});

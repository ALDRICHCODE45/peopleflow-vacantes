import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { candidateProfileSchema } from "@/features/candidate/model";
import type { CandidateProfile } from "@/features/candidate/model";
import { CANDIDATE_IDENTITY, CANDIDATE_PROFILE } from "@/features/candidate/prototype-candidate";
import { CANDIDATE_APPLICATIONS, CANDIDATE_CVS } from "@/features/candidate/prototype-portfolio";
import { CandidateDashboardOverview, profileCompleteness } from "./candidate-dashboard-overview";

// Source as text, so layout, token and coupling contracts stay asserted here.
const SOURCE = readFileSync(join(process.cwd(), "src/components/candidate-dashboard/candidate-dashboard-overview.tsx"), "utf8");
const CANONICAL_LINKS = ["/candidato/postulaciones", "/candidato/perfil", "/candidato/cvs"] as const, STATUS_LABELS = ["Enviada", "En revisión", "Contratada", "Rechazada"] as const;

/** An empty-but-valid profile: every scored field unset, still schema-valid. */
function emptyProfile(): CandidateProfile {
  return candidateProfileSchema.parse({
    ...CANDIDATE_PROFILE,
    phone: null, linkedinUrl: null, portfolioUrl: null, professionalTitle: null, currentCompany: null,
    yearsOfExperience: null, summary: null, birthDate: null, city: null, country: null, educationLevel: null,
    fieldOfStudy: null, skills: [], currentSalaryGross: null, currentSalaryNet: null, expectedSalary: null,
    expectedSalaryPeriod: null, languages: [],
  });
}

/** One valid profile with only the chosen fields unset, so boundaries stay isolated. */
function profileWithout(...missing: readonly (keyof CandidateProfile)[]): CandidateProfile {
  const overrides = Object.fromEntries(missing.map((key) => [key, key === "skills" || key === "languages" ? [] : null]));
  return candidateProfileSchema.parse({ ...CANDIDATE_PROFILE, ...overrides });
}

function renderOverview(overrides: Partial<Parameters<typeof CandidateDashboardOverview>[0]> = {}) {
  return render(
    <CandidateDashboardOverview identity={CANDIDATE_IDENTITY} profile={CANDIDATE_PROFILE} applications={CANDIDATE_APPLICATIONS} cvs={CANDIDATE_CVS} {...overrides} />,
  );
}

const metric = (label: string) => document.querySelector(`[data-pf-overview-metric="${label}"]`) as HTMLElement;
const section = (name: string) => document.querySelector(`[data-pf-${name}]`) as HTMLElement;
const modules = () => [...new Set([...SOURCE.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]))].sort();

afterEach(cleanup);

describe("profile completeness helper", () => {
  it("scores the complete fixture as 100% and stays pure", () => {
    const before = JSON.stringify(CANDIDATE_PROFILE);
    expect(profileCompleteness(CANDIDATE_PROFILE)).toEqual({ completed: 13, total: 13, percentage: 100, missing: [] });
    profileCompleteness(CANDIDATE_PROFILE);
    expect(JSON.stringify(CANDIDATE_PROFILE)).toBe(before);
  });

  it("names only the missing checklist labels for a valid incomplete profile", () => {
    const incomplete = profileCompleteness(profileWithout("summary", "languages"));
    expect(incomplete.completed).toBe(11);
    expect(incomplete.percentage).toBe(85);
    expect(incomplete.missing).toEqual(["Resumen profesional", "Idiomas"]);
  });
  it("returns a bounded zero score for an empty valid profile", () => {
    const empty = profileCompleteness(emptyProfile());
    expect(empty.completed).toBe(0);
    expect(empty.percentage).toBe(0);
    expect(empty.missing).toHaveLength(empty.total);
  });
});

describe("candidate dashboard overview", () => {
  it("renders the frozen fixture shape as candidate-first metrics", () => {
    renderOverview();
    expect(screen.getByRole("heading", { level: 2, name: /Hola, Ximena/ })).toBeInTheDocument();
    expect(metric("Postulaciones")).toHaveTextContent("4 postulaciones registradas");
    expect(metric("En proceso")).toHaveTextContent("2");
    expect(metric("En proceso")).toHaveTextContent("Enviadas o en revisión");
    expect(metric("Perfil completo")).toHaveTextContent("100%");
    expect(metric("Perfil completo")).toHaveTextContent("13 de 13 campos completados");
    expect(metric("CVs")).toHaveTextContent("2 CVs disponibles");
    expect(screen.getByRole("note")).toHaveAttribute("data-pf-candidate-overview-disclosure");
    expect(screen.getByRole("note")).toHaveTextContent(/demo local/i);
    expect(screen.getByRole("note")).toHaveTextContent(/no guarda cambios/i);
  });

  it("breaks down every application by the exact four Spanish statuses", () => {
    renderOverview();
    const breakdown = section("status-breakdown");
    expect(within(breakdown).getAllByRole("listitem")).toHaveLength(4);
    for (const label of STATUS_LABELS) expect(within(breakdown).getByText(label)).toBeInTheDocument();
    for (const item of within(breakdown).getAllByRole("listitem")) expect(item.textContent).toMatch(/1$/u);
  });

  it("orders recent applications by updatedAt desc, caps at three and never mutates props", () => {
    const reversed = [...CANDIDATE_APPLICATIONS].reverse();
    const before = JSON.stringify(reversed);
    renderOverview({ applications: reversed });
    const rows = within(section("recent-applications")).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Desarrolladora Go"),
      expect.stringContaining("Ingeniera Frontend"),
      expect.stringContaining("Analista de Datos"),
    ]);
    expect(section("recent-applications")).not.toHaveTextContent("Diseñadora UX");
    expect(JSON.stringify(reversed)).toBe(before);
    expect(reversed[0].jobTitle).toBe("Diseñadora UX");
  });

  it("links only rows with a canonical publicJobHref and keeps historical rows text-only", () => {
    renderOverview();
    const recent = section("recent-applications");
    const rows = within(recent).getAllByRole("listitem");
    expect(within(recent).getAllByRole("link")).toHaveLength(3);
    const firstLink = within(rows[0]).getByRole("link", { name: /Ver vacante de Desarrolladora Go/ });
    expect(firstLink).toHaveAttribute("href", CANDIDATE_APPLICATIONS[0].publicJobHref);
    expect(within(rows[1]).getByRole("link", { name: /Ver vacante de Ingeniera Frontend/ })).toHaveAttribute("href", CANDIDATE_APPLICATIONS[1].publicJobHref);
    expect(within(rows[2]).queryByRole("link")).toBeNull();
    expect(rows[2]).toHaveTextContent("Vacante histórica sin enlace");
  });

  it("renders deterministic dates and the exact primary CV snapshot", () => {
    renderOverview();
    const recent = section("recent-applications");
    expect(recent).toHaveTextContent("Actualizada el 5 de marzo de 2026");
    const cv = section("cv-snapshot");
    expect(cv).toHaveTextContent("CV principal");
    expect(cv).toHaveTextContent("ximena-barrera-cv.pdf");
    expect(cv).toHaveTextContent("Español");
    expect(cv).toHaveTextContent("340 KB");
    expect(cv).toHaveTextContent("10 de marzo de 2026");
    expect(cv).toHaveTextContent("2 CVs");
    expect(cv).toHaveTextContent("Ver mis CVs");
  });

  it("reports profile readiness when complete and names only missing items otherwise", () => {
    renderOverview();
    expect(section("profile-guidance")).toHaveTextContent("Tu perfil está listo");
    cleanup();
    renderOverview({ profile: profileWithout("professionalTitle", "skills", "linkedinUrl") });
    const guidance = section("profile-guidance");
    expect(guidance).toHaveTextContent("Tu perfil está al 77%");
    expect(within(guidance).getByText("Título profesional")).toBeInTheDocument();
    expect(within(guidance).getByText("Habilidades")).toBeInTheDocument();
    expect(within(guidance).getByText("LinkedIn")).toBeInTheDocument();
    expect(guidance).not.toHaveTextContent("Resumen profesional");
  });

  it("uses natural Spanish singular and plural forms", () => {
    renderOverview({ applications: [CANDIDATE_APPLICATIONS[0]], cvs: [CANDIDATE_CVS[0]] });
    expect(metric("Postulaciones")).toHaveTextContent("1 postulación registrada");
    expect(metric("CVs")).toHaveTextContent("1 CV disponible");
    expect(screen.getByText(/1 en proceso/)).toBeInTheDocument();
    cleanup();
    renderOverview({ profile: profileWithout("portfolioUrl") });
    expect(section("profile-guidance")).toHaveTextContent("Te falta 1 campo");
  });

  it("stays honest with empty applications and CVs, zeroing every metric", () => {
    renderOverview({ applications: [], cvs: [] });
    expect(metric("Postulaciones")).toHaveTextContent("0 postulaciones registradas");
    expect(metric("En proceso")).toHaveTextContent("0");
    expect(metric("CVs")).toHaveTextContent("Sin CVs disponibles");
    expect(section("recent-applications")).toHaveTextContent("Todavía no tienes postulaciones");
    expect(section("cv-snapshot")).toHaveTextContent("no permite subir archivos");
    for (const item of within(section("status-breakdown")).getAllByRole("listitem")) expect(item.textContent).toMatch(/0$/u);
  });

  it("exposes the three canonical workspace links with 40px targets and visible focus", () => {
    renderOverview();
    const all = screen.getAllByRole("link");
    for (const href of CANONICAL_LINKS) {
      const link = all.find((node) => node.getAttribute("href") === href);
      expect(link, href).toBeTruthy();
      expect(link!.className).toContain("min-h-10");
      expect(link!.className).toContain("focus-visible:ring");
    }
    for (const link of all) {
      expect(link.getAttribute("href")).not.toBe("#");
      expect(link.className).toContain("min-h-10");
    }
  });
  it("is a server component with no side effects, fixtures or employer coupling", () => {
    expect(SOURCE).not.toMatch(/["']use client["']/);
    for (const forbidden of ["useState", "useEffect", "onClick", "<button", "<form", "<input", "fetch(", "localStorage", "sessionStorage", "document.cookie", "next/headers", "useRouter", "usePathname", "window.", "setTimeout", "setInterval", "Math.random", "Date.now", "formatDistance", "toRelative", "XMLHttpRequest", "navigator.clipboard", "cargado", "Gestionar"]) {
      expect(SOURCE, forbidden).not.toContain(forbidden);
    }
    expect(modules()).toEqual(["@/features/candidate/model", "@/features/candidate/portfolio-model", "next/link"]);
    expect(SOURCE).not.toMatch(/prototype-|company-dashboard|employer/u);
  });
  it("uses candidate cyan primary tokens, responsive grids and no fixed width", () => {
    expect(SOURCE).toContain("bg-primary");
    expect(SOURCE).toContain("text-muted-foreground");
    expect(SOURCE).toContain("bg-card");
    expect(SOURCE).toContain("border-border");
    expect(SOURCE).toContain("grid-cols-1");
    expect(SOURCE).toContain("sm:grid-cols-2");
    expect(SOURCE).toContain("xl:grid-cols-4");
    expect(SOURCE).not.toMatch(/#[0-9a-fA-F]{6}/u);
    expect(SOURCE).not.toMatch(/\b(?:bg|text|border)-cyan\b/u);
    expect(SOURCE).not.toMatch(/\bw-\[\d+px\]/u);
  });
});

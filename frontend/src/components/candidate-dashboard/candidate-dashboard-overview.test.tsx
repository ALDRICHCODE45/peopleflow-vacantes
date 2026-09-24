import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { candidateProfileSchema } from "@/features/candidate/model";
import type { CandidateProfile } from "@/features/candidate/model";
import { CANDIDATE_IDENTITY, CANDIDATE_PROFILE } from "@/features/candidate/prototype-candidate";
import { CANDIDATE_APPLICATIONS, CANDIDATE_CVS } from "@/features/candidate/prototype-portfolio";
import type { CandidateApplicationView } from "@/features/candidate/portfolio-model";
import { CandidateDashboardOverview, profileCompleteness } from "./candidate-dashboard-overview";

// Source as text, so layout, token and coupling contracts stay asserted here.
const SOURCE = readFileSync(join(process.cwd(), "src/components/candidate-dashboard/candidate-dashboard-overview.tsx"), "utf8");
/** Strips technical comments so the rendered-copy ban inspects only product strings. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/\/\/[^\n]*/gu, " ");
/** Rendered copy may not expose implementation status; `\b` keeps `localStorage` and data ids intact. */
const IMPLEMENTATION_STATUS_COPY = /\b(?:demo|mock|prototip\w*|fictici\w*|prueba|test|local|no disponible|no implementado|no se guarda|no se env[ií]a|no se sube)\b/iu;
const CANONICAL_LINKS = ["/candidato/postulaciones", "/candidato/perfil", "/candidato/cvs"] as const, STATUS_LABELS = ["Enviada", "En revisión", "Contratada", "Rechazada"] as const;
const STATUS_VARIANTS = { submitted: "info", in_review: "review", hired: "success", rejected: "danger" } as const;
const STATUS_TOKENS = { submitted: "status-info", in_review: "status-review", hired: "status-success", rejected: "status-danger" } as const;

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

/** Unique-id clones so proportional status counts never collide or mutate fixtures. */
function applicationsWith(statuses: readonly CandidateApplicationView["status"][]): readonly CandidateApplicationView[] {
  return statuses.map((status, index) => ({ ...CANDIDATE_APPLICATIONS[0], id: `status-${index}`, status, publicJobHref: null }));
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
    for (const [label, value] of [["Postulaciones", "4"], ["En proceso", "2"], ["Perfil completo", "100%"], ["CVs", "2"]] as const) {
      expect(metric(label).querySelector("[data-pf-overview-metric-value]")?.textContent, label).toBe(value);
    }
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.queryByText(/demo local/iu)).toBeNull();
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
    expect(section("cv-snapshot")).toHaveTextContent("Cuando agregues un CV");
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
    expect(modules()).toEqual([
      "@/components/ui/badge",
      "@/components/ui/button",
      "@/components/ui/card",
      "@/components/ui/empty",
      "@/components/ui/item",
      "@/components/ui/progress",
      "@/features/candidate/model",
      "@/features/candidate/portfolio-model",
      "lucide-react",
      "next/link",
    ]);
    expect(SOURCE).not.toMatch(/prototype-|company-dashboard|employer/u);
    // Rendered copy must stay product-facing: no implementation-status disclosure.
    expect(IMPLEMENTATION_STATUS_COPY.test(stripComments(SOURCE))).toBe(false);
    expect(SOURCE).not.toContain("data-pf-candidate-overview-disclosure");
    // The semantic mapping and completeness variant replaced the local tone recipes.
    expect(SOURCE).toContain("type BadgeVariant");
    expect(SOURCE).toMatch(/STATUS_VARIANT: Readonly<Record<ApplicationStatus, BadgeVariant>>/u);
    expect(SOURCE).toContain("<Badge variant={STATUS_VARIANT[status]} dot>");
    expect(SOURCE).toContain('variant={completeness.percentage === 100 ? "success" : "review"}');
    // The primary CV role is the shared pastel accent recipe, not a filled default span.
    expect(SOURCE).toContain('<Badge variant="accent">Principal</Badge>');
    expect(SOURCE).not.toContain("<Badge>Principal</Badge>");
    for (const recipe of ["STATUS_TONE", "COMPLETE_BADGE", "INCOMPLETE_BADGE", "border-status-"]) {
      expect(SOURCE, `candidate-dashboard-overview.tsx must not keep ${recipe}`).not.toContain(recipe);
    }
  });
  it("keeps token-only paint, responsive candidate grids and no translucent handmade surface", () => {
    // globals.css owns the preset; the overview only consumes semantic tokens.
    expect(SOURCE).not.toMatch(/--primary\s*:/u);
    for (const raw of ["#0e7490", "#22d3ee", "#0c0912"]) expect(SOURCE).not.toContain(raw);
    expect(SOURCE).toContain("bg-primary");
    expect(SOURCE).toContain("text-muted-foreground");
    for (const grid of ["grid-cols-1", "sm:grid-cols-2", "xl:grid-cols-4", "lg:grid-cols-3", "lg:col-span-2", "lg:grid-cols-2"]) expect(SOURCE).toContain(grid);
    for (const legacy of ["bg-card/60", "bg-card/40", "bg-background/40", "bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4"]) expect(SOURCE, legacy).not.toContain(legacy);
    expect(SOURCE).not.toMatch(/#[0-9a-fA-F]{6}/u);
    expect(SOURCE).not.toMatch(/\b(?:bg|text|border)-cyan\b/u);
    expect(SOURCE).not.toMatch(/\bw-\[\d+px\]/u);
  });

  it("composes the approved hierarchy from exactly eight shadcn Card roots", () => {
    const { container } = renderOverview();
    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(8);
    for (const label of ["Postulaciones", "En proceso", "Perfil completo", "CVs"]) {
      const card = metric(label);
      expect(card).toHaveAttribute("data-slot", "card");
      expect(card.querySelector('[data-slot="card-header"]')).not.toBeNull();
      expect(card.querySelector('[data-slot="card-content"]')).not.toBeNull();
    }
  });

  it("names each dashboard section with a real h3 under the single greeting h2", () => {
    const { container } = renderOverview();
    expect(container.querySelectorAll("h2")).toHaveLength(1);
    const sections: readonly (readonly [string, string])[] = [
      ["recent-applications", "Postulaciones recientes"],
      ["status-breakdown", "Estado de tus postulaciones"],
      ["profile-guidance", "Tu perfil"],
      ["cv-snapshot", "Tus CVs"],
    ];
    for (const [name, title] of sections) {
      const node = section(name);
      expect(node.querySelector('[data-slot="card"]')).not.toBeNull();
      expect(node.querySelector('[data-slot="card-content"]')).not.toBeNull();
      expect(within(node).getByRole("heading", { level: 3, name: title })).toBeInTheDocument();
    }
  });

  it("backs the three recent rows and the primary CV with installed Item rows", () => {
    const { container } = renderOverview();
    const rows = within(section("recent-applications")).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      const item = row.querySelector('[data-slot="item"]');
      expect(item).not.toBeNull();
      for (const slot of ["item-media", "item-content", "item-title", "item-description", "item-actions"]) {
        expect(item!.querySelector(`[data-slot="${slot}"]`), slot).not.toBeNull();
      }
    }
    expect(section("cv-snapshot").querySelectorAll('[data-slot="item"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-slot="item"]')).toHaveLength(4);
  });

  it("renders each recent status as a semantic Badge variant with a decorative dot", () => {
    renderOverview();
    const rows = within(section("recent-applications")).getAllByRole("listitem");
    const expected = [
      ["Enviada", "submitted"],
      ["En revisión", "in_review"],
      ["Contratada", "hired"],
    ] as const;
    for (const [index, [label, status]] of expected.entries()) {
      const node = within(rows[index]).getByText(label);
      expect(node).toHaveAttribute("data-slot", "badge");
      expect(node).toHaveAttribute("data-variant", STATUS_VARIANTS[status]);
      expect(node).toHaveAttribute("data-dot");
      expect(node.className).toContain(STATUS_TOKENS[status]);
      // The dot is the shared recipe's `::before`, never a manually rendered child.
      expect(node.childNodes).toHaveLength(1);
      expect(node.querySelectorAll("*")).toHaveLength(0);
    }
  });

  it("renders the completeness badge as the dotless success/review variant", () => {
    renderOverview();
    const complete = screen.getByText("Completo");
    expect(complete).toHaveAttribute("data-slot", "badge");
    expect(complete).toHaveAttribute("data-variant", "success");
    expect(complete).not.toHaveAttribute("data-dot");
    cleanup();
    renderOverview({ profile: profileWithout("professionalTitle") });
    const incomplete = screen.getByText("Incompleto");
    expect(incomplete).toHaveAttribute("data-variant", "review");
    expect(incomplete).not.toHaveAttribute("data-dot");
    expect(incomplete.querySelectorAll("*")).toHaveLength(0);
  });

  it("paints the proportional status bar from canonical semantic tokens only", () => {
    const { container } = renderOverview({ applications: applicationsWith(["submitted", "submitted", "submitted", "in_review", "hired", "rejected"]) });
    for (const token of ["bg-status-info", "bg-status-review", "bg-status-success", "bg-status-danger"]) expect(SOURCE).toContain(token);
    expect(SOURCE).not.toMatch(/\b(?:bg|text|border)-chart-/u);
    expect(SOURCE).not.toMatch(/in_review:\s*"bg-primary"/u);
    const expected: Record<string, string> = { submitted: "3", in_review: "1", hired: "1", rejected: "1" };
    const segments = container.querySelectorAll("[data-pf-status-segment]");
    expect(segments).toHaveLength(4);
    for (const segment of segments) {
      expect(segment.className).toContain("basis-0");
      expect((segment as HTMLElement).style.flexGrow).toBe(expected[segment.getAttribute("data-pf-status-segment") ?? ""]);
    }
  });

  it("zeroes every proportional segment when no applications exist", () => {
    const { container } = renderOverview({ applications: [] });
    for (const segment of container.querySelectorAll("[data-pf-status-segment]")) {
      expect((segment as HTMLElement).style.flexGrow).toBe("0");
    }
  });

  it("derives a native Progress for the profile completeness", () => {
    const { container } = renderOverview();
    const bar = container.querySelector('[data-slot="progress"]') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(bar).toHaveAttribute("aria-label", "Perfil completo");
    expect(bar.querySelector('[data-slot="progress-label"]')).not.toBeNull();
    expect(bar.querySelector('[data-slot="progress-value"]')?.textContent).toMatch(/100\s?%/u);
    expect(section("profile-guidance")).toHaveTextContent("13 de 13 campos completados");
  });

  it("spans the overview across the full candidate workspace measure with one padding owner", () => {
    const { container } = renderOverview();
    const root = container.querySelector("[data-pf-candidate-overview]") as HTMLElement;
    const tokens = root.className.split(/\s+/u);
    expect(["mx-auto", "w-full", "max-w-screen-2xl"].filter((token) => !tokens.includes(token))).toEqual([]);
    expect(["px-4", "py-4", "lg:px-6"].filter((token) => !tokens.includes(token))).toEqual([]);
    const inner = container.querySelector("[data-pf-candidate-overview-inner]") as HTMLElement;
    expect(inner).not.toBeNull();
    const innerTokens = inner.className.split(/\s+/u);
    // The inner stack spans the full workspace: no narrower measure, no duplicate
    // centering and no second padding owner. `max-w-5xl` must never return.
    expect(innerTokens).toContain("w-full");
    expect(innerTokens).not.toContain("max-w-5xl");
    expect(innerTokens.filter((token) => token.startsWith("max-w-"))).toEqual([]);
    expect(innerTokens).not.toContain("mx-auto");
    expect(innerTokens.filter((token) => /^p[xy]?-/u.test(token))).toEqual([]);
    const owners = Array.from(container.querySelectorAll("[class]")).filter((node) => {
      const value = (node.getAttribute("class") ?? "").split(/\s+/u);
      return value.includes("px-4") && value.includes("lg:px-6");
    });
    expect(owners).toHaveLength(1);
    expect(owners[0]).toBe(root);
  });

  it("renders recent rows as a compact grouped list with unclamped titles and a readable CV filename", () => {
    renderOverview();
    const list = section("recent-applications").querySelector("ul") as HTMLElement;
    expect(list.className).toContain("divide-y");
    for (const row of within(section("recent-applications")).getAllByRole("listitem")) {
      const item = row.querySelector('[data-slot="item"]') as HTMLElement;
      const title = row.querySelector('[data-slot="item-title"]') as HTMLElement;
      expect(title.className).toContain("line-clamp-none");
      expect(title.className).not.toContain("line-clamp-1");
      expect(title.className).toContain("w-full");
      // A grouped list uses quiet rows, never the outlined mini-card surface.
      expect(item.className).not.toContain("border-border");
    }
    const description = section("cv-snapshot").querySelector('[data-slot="item-description"]') as HTMLElement;
    expect(description.className).toContain("break-words");
    expect(description.className).not.toContain("break-all");
    expect(description.className).toContain("line-clamp-none");
    // The primary CV role is the pastel accent Badge, dotless like every role.
    const primaryBadge = screen.getByText("Principal");
    expect(primaryBadge).toHaveAttribute("data-slot", "badge");
    expect(primaryBadge).toHaveAttribute("data-variant", "accent");
    expect(primaryBadge).not.toHaveAttribute("data-dot");
    expect(primaryBadge.className).toContain("border-primary/40");
    expect(primaryBadge.className).toContain("text-foreground");
    expect(primaryBadge.querySelectorAll("*")).toHaveLength(0);
    expect(SOURCE).toContain('<Badge variant="accent">Principal</Badge>');
    expect(SOURCE).not.toContain("break-all");
    expect(SOURCE).toContain("data-pf-overview-metric-value");
  });
});

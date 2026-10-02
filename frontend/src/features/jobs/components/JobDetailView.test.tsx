import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  employmentTypeLabel,
  formatClosingDate,
  formatPublishedDate,
  formatSalary,
  payFrequencyLabel,
  seniorityLabel,
  workModeLabel,
} from "../formatters";
import { vacancyApplicationHref } from "../application/application-draft";
import { PROTOTYPE_COMPANY_ID } from "../../company-profile/model";
import { ACME_PROTOTYPE_PROFILE } from "../../company-profile/prototype-companies";
import { enrichJob } from "../enrich";
import type { PrototypeJobView } from "../enrich";
import type { JobItem } from "../types";
import { companyInitials, prototypeApplicantsLabel, prototypeResponseLabel } from "./prototype-ui";
import { JobDetailView } from "./JobDetailView";

/** Font-size utilities share the `text-` prefix with the color utilities below. */
const FONT_SIZE_TOKENS = new Set(["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl"]);
/** Every text-color utility a class list applies, keeping its variant prefix. */
const textColorUtilities = (className: string) =>
  className
    .split(/\s+/)
    .filter((utility) => utility.includes("text-"))
    .filter((utility) => !FONT_SIZE_TOKENS.has(utility.slice(utility.lastIndexOf("text-") + 5)));
/** Any Tailwind palette utility would be a raw color: only tokens are allowed. */
const RAW_COLOR_UTILITY =
  /(?:^|\s|[a-z-]+:)(?:text|bg|border)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)-\d{2,3}(?:\s|$)/;
/** Every prop a server view may forward across the server/client boundary. */
const ISLAND_PROPS = ["icon", "label", "className", "iconClassName", "iconPosition", "iconOnly", "text", "title", "describedBy"];
/** The four placeholder control names, in rail order. */
const DEMO_NAMES = ["Guardar vacante", "Copiar enlace", "Compartir en redes", "Enviar por correo"] as const;
/** Comments never render, so they are stripped before scanning shipping source. */
const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/\/\/[^\n]*/gu, " ");
/**
 * Implementation-status display copy banned from shipping source. Each entry is
 * prose, never a technical identifier such as `PrototypeRoleSection`,
 * `data-detail-card="prototype"`, or `vacante-rol`, and comments are stripped.
 */
const STATUS_DISPLAY_COPY = /demostraci[óo]n|fictici[ao]s?|solo demostraci|marcada solo|no se guard[óo]|no se guarda|no se copi[óo]|no se comparti[óo]|no se envi[oó]|no se env[ií]a|no disponible|no implementado|\bPrototipo\b|\bprototipo\b/iu;

const baseJob: JobItem = {
  id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e",
  title: "Ingeniera Frontend",
  description: "Construye experiencias accesibles.",
  work_mode: "remote",
  employment_type: "full_time",
  seniority: "senior",
  salary_currency: "MXN",
  company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f", name: "Acme" },
};

// Markup-like middle segments must render as text, never be interpreted.
const UNSAFE_DESCRIPTION =
  "Primer párrafo de la vacante.\n\n<script>alert('xss')</script>\n\nSegundo párrafo con <img src=x onerror=alert(1)> incrustado.\n\nLínea uno\nLínea dos.";

describe("JobDetailView validated rendering", () => {
  const fullJob: JobItem = {
    ...baseJob,
    location: "Monterrey, Nuevo León",
    salary_min: 30000,
    salary_max: 45000,
    published_at: "2026-02-14T09:30:00Z",
  };

  it("renders one article with the title, company, full metadata, and back navigation", () => {
    const { salary_min: min, salary_max: max, salary_currency: cur } = fullJob;
    const salary = formatSalary({ min, max, currency: cur });
    render(<JobDetailView job={fullJob} />);
    const view = within(screen.getByRole("article"));
    const h1 = view.getAllByRole("heading", { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0]).toHaveAccessibleName(fullJob.title);
    expect(view.getByText(fullJob.company.name)).toBeVisible();
    expect(view.getByText(fullJob.location!)).toBeVisible();
    expect(view.getByText(salary!)).toBeVisible();
    expect(view.getByText(/publicada/i)).toBeVisible();
    for (const label of ["Remoto", "Tiempo completo", "Senior"]) {
      expect(view.getByText(label, { exact: true })).toBeVisible();
    }
    const back = view.getByRole("link", { name: /volver a vacantes/i });
    expect(back).toHaveAttribute("href", "/vacantes");
    // A wire-only vacancy never links the header company name anywhere.
    expect(view.getByText(fullJob.company.name).closest("a")).toBeNull();
  });

  it("renders the description as escaped plain text with paragraphs and line breaks", () => {
    const job = { ...baseJob, description: UNSAFE_DESCRIPTION };
    const { container } = render(<JobDetailView job={job} />);
    const article = container.querySelector("article");
    expect(article).not.toBeNull();
    expect(article!.querySelector("script")).toBeNull();
    expect(article!.querySelector("img")).toBeNull();
    expect(screen.getByText("<script>alert('xss')</script>")).toBeVisible();
    // Blank lines split paragraphs; a single break stays inside one paragraph.
    const paragraphs = screen.getAllByRole("paragraph");
    expect(paragraphs).toHaveLength(4);
    expect(paragraphs[3].textContent).toBe("Línea uno\nLínea dos.");
  });

  it("omits absent optional metadata instead of showing placeholders", () => {
    render(<JobDetailView job={baseJob} />);
    const article = screen.getByRole("article");
    expect(article).toBeVisible();
    expect(screen.queryByText(/publicada/i)).toBeNull();
    expect(screen.queryByText(/MXN|USD/)).toBeNull();
    expect(screen.queryByText(/Desde|Hasta/)).toBeNull();
    expect(article.textContent).not.toContain("undefined");
  });
});

describe("JobDetailView prototype role block", () => {
  const enrichedJob = enrichJob(baseJob);

  /**
   * The company-profile link is body-sized, so WCAG AA requires 4.5:1: its
   * base color must be the semantic `text-foreground` token, which is defined
   * for the light and the dark theme alike, with no theme- or state-scoped
   * color override, and its affordance must be the always-visible underline
   * instead of hover only. `text-primary` reaches only ~2.1:1 on the dark
   * page background, so it may not be the base or the hover text color.
   */
  const expectHighContrastBodyLink = (link: HTMLElement) => {
    const { className } = link;
    expect(className).toMatch(/(?:^|\s)text-(?:sm|base)(?:\s|$)/);
    const colors = textColorUtilities(className);
    expect(colors.length).toBeGreaterThan(0);
    for (const color of colors) expect(color).toMatch(/^(?:[a-z-]+:)*text-foreground$/);
    expect(className).not.toMatch(/(?:^|\s)(?:[a-z-]+:)*text-primary(?:\/\d+)?(?:\s|$)/);
    expect(className).toMatch(/(?:^|\s)underline(?:\s|$)/);
    expect(className).not.toMatch(/(?:^|\s)no-underline(?:\s|$)/);
  };

  it("keeps one H1, the four description paragraphs, and no image or script", () => {
    const job: PrototypeJobView = { ...enrichedJob, description: UNSAFE_DESCRIPTION };
    const { container } = render(<JobDetailView job={job} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const content = container.querySelector("[data-detail-region='content']");
    expect(within(content as HTMLElement).getAllByRole("paragraph")).toHaveLength(4);
    expect(container.querySelectorAll("article img, article script")).toHaveLength(0);
    // The breadcrumb stays the article's first list item, so no prototype list
    // can precede the header, and the view adds no inline style.
    expect(container.querySelector("article li")?.textContent).toBe("Vacantes");
    expect(container.querySelectorAll("article [style]")).toHaveLength(0);
  });

  it("renders prototype list text as escaped plain text and adds no paragraph", () => {
    const unsafeList = "<img src=x onerror=alert(1)>";
    const job: PrototypeJobView = {
      ...enrichedJob,
      prototype: {
        ...enrichedJob.prototype!,
        requiredRequirements: [unsafeList],
        preferredRequirements: ["<b>Next.js</b>"],
        skills: ["<script>alert('skill')</script>"],
        benefits: ["<em>Seguro de salud</em>"],
      },
    };
    const { container } = render(<JobDetailView job={job} />);
    expect(screen.getByText(unsafeList)).toBeVisible();
    expect(screen.getByText("<script>alert('skill')</script>")).toBeVisible();
    expect(screen.getByText("<b>Next.js</b>")).toBeVisible();
    expect(
      container.querySelectorAll("article img, article script, article b, article em"),
    ).toHaveLength(0);
    // Only the wire description is a paragraph: the prototype block is not.
    const content = container.querySelector("[data-detail-region='content']");
    expect(within(content as HTMLElement).getAllByRole("paragraph")).toHaveLength(1);
  });

  it("renders the disclosed prototype role content from the enrichment only", () => {
    const prototype = enrichedJob.prototype!;
    const job: PrototypeJobView = { ...enrichedJob, salary_min: 30000, salary_max: 45000 };
    render(<JobDetailView job={job} />);
    expect(
      screen.getByRole("heading", { level: 2, name: prototype.department }),
    ).toBeVisible();
    expect(screen.getByText("Frecuencia de pago")).toBeVisible();
    expect(screen.getByText(payFrequencyLabel(prototype.payFrequency))).toBeVisible();
    expect(screen.getByText(formatClosingDate(prototype.closingDate!))).toBeVisible();
    for (const label of ["Indispensables", "Deseables"]) {
      expect(screen.getByRole("heading", { level: 4, name: label })).toBeVisible();
    }
    for (const label of ["Requisitos", "Habilidades", "Beneficios"]) {
      expect(screen.getByRole("heading", { level: 3, name: label })).toBeVisible();
    }
    for (const text of [
      ...prototype.requiredRequirements,
      ...prototype.preferredRequirements,
      ...prototype.skills,
      ...prototype.benefits,
    ]) {
      expect(screen.getByText(text)).toBeVisible();
    }
    // The wire salary keeps its own header slot; the pay frequency is disclosed
    // separately and never fuses into the salary string.
    const salary = formatSalary({ min: 30000, max: 45000, currency: "MXN" })!;
    expect(screen.getByText(salary)).toBeVisible();
    expect(salary).not.toContain(payFrequencyLabel(prototype.payFrequency));
  });

  it("links to the canonical company profile without any disclosure copy", () => {
    render(<JobDetailView job={enrichedJob} />);
    const link = screen.getByRole("link", { name: `Conoce a ${ACME_PROTOTYPE_PROFILE.name}` });
    expect(link).toHaveAttribute("href", `/empresas/${PROTOTYPE_COMPANY_ID}`);
    expectHighContrastBodyLink(link);
    expect(screen.queryByText(/ficticia|prototipo/iu)).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
    // The header company becomes a link only under that same exact opt-in match.
    const company = screen.getByRole("link", { name: baseJob.company.name });
    expect(company).toHaveAttribute("href", `/empresas/${PROTOTYPE_COMPANY_ID}`);
    expectHighContrastBodyLink(company);
  });

  it("omits the closing date when the enrichment declares none", () => {
    const job: PrototypeJobView = {
      ...enrichedJob,
      prototype: { ...enrichedJob.prototype!, closingDate: undefined },
    };
    render(<JobDetailView job={job} />);
    expect(screen.getByText("Frecuencia de pago")).toBeVisible();
    expect(screen.queryByText("Cierre de postulaciones")).toBeNull();
  });

  it("nests the prototype block headings inside the page hierarchy", () => {
    const { container } = render(<JobDetailView job={enrichedJob} />);
    const block = container.querySelector("section[aria-labelledby='vacante-rol']");
    const headings = [...(block?.querySelectorAll("h1, h2, h3, h4, h5, h6") ?? [])];
    expect(headings.map((heading) => [heading.tagName, heading.textContent])).toEqual([
      ["H2", enrichedJob.prototype!.department],
      ["H3", "Requisitos"],
      ["H4", "Indispensables"],
      ["H4", "Deseables"],
      ["H3", "Habilidades"],
      ["H3", "Idiomas"],
      ["H3", "Beneficios"],
      ["H3", "Antes de postularte"],
      ["H4", "Preguntas al postularte"],
    ]);
  });

  it("keeps heading levels in document order with no skipped level", () => {
    const { container } = render(<JobDetailView job={enrichedJob} />);
    const levels = [...container.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((heading) =>
      Number(heading.tagName.slice(1)),
    );
    expect(levels).toEqual([1, 2, 2, 3, 4, 4, 3, 3, 3, 3, 4, 3, 3, 3]);
    levels.forEach((level, index) => {
      if (index > 0) expect(level - levels[index - 1]).toBeLessThanOrEqual(1);
    });
  });

  it("omits the prototype block entirely for a wire-only vacancy", () => {
    render(<JobDetailView job={baseJob} />);
    expect(screen.queryByRole("heading", { name: /prototipo/i })).toBeNull();
    expect(screen.queryByText(/frecuencia de pago/i)).toBeNull();
    expect(screen.queryByRole("link", { name: /conoce a/i })).toBeNull();
  });

  it("keeps the prototype block without a company link when no profile matches", () => {
    const job: PrototypeJobView = {
      ...enrichedJob,
      company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d99", name: "Otra Empresa" },
    };
    render(<JobDetailView job={job} />);
    expect(screen.getByRole("heading", { level: 2, name: job.prototype!.department })).toBeVisible();
    expect(screen.queryByRole("link", { name: /conoce a/i })).toBeNull();
    expect(screen.queryByText(/ficticia/iu)).toBeNull();
    expect(screen.getByText("Otra Empresa").closest("a")).toBeNull();
  });
});

describe("JobDetailView reference header, stats, and scaffold (CCP-R4A)", () => {
  const enrichedJob = enrichJob(baseJob);
  const fullJob: JobItem = {
    ...baseJob,
    location: "Monterrey, Nuevo León",
    salary_min: 30000,
    salary_max: 45000,
    published_at: "2026-02-14T09:30:00Z",
  };
  const viewSource = readFileSync(join(process.cwd(), "src/features/jobs/components/JobDetailView.tsx"), "utf8");
  const region = (container: HTMLElement, name: string) => {
    const element = container.querySelector<HTMLElement>(`article [data-detail-region='${name}']`);
    if (element === null) throw new Error(`missing detail region: ${name}`);
    return element;
  };
  const stat = (container: HTMLElement, key: string) => {
    const card = container.querySelector(`article [data-detail-stat='${key}']`);
    if (card === null) throw new Error(`missing detail stat: ${key}`);
    return card;
  };

  it("keeps the canonical list breadcrumb with its exact href, label, and current title", () => {
    render(<JobDetailView job={fullJob} />);
    const nav = screen.getByRole("navigation", { name: "Ruta de navegación" });
    const link = within(nav).getByRole("link", { name: "Volver a vacantes" });
    expect(link).toHaveAttribute("href", "/vacantes");
    expect(link).toHaveTextContent("Vacantes");
    expect(link).toHaveClass("min-h-10");
    expect(within(nav).getByText(fullJob.title).closest("li")).toHaveAttribute("aria-current", "page");
    // The leading return affordance belongs to the link: no decorative glyph
    // sits before it, so the icon never reads as a dead back control.
    expect(link.closest("li")!.firstElementChild).toBe(link);
  });

  it("rebuilds the header with monogram, featured state, and metrics", () => {
    const { container } = render(<JobDetailView job={enrichedJob} />);
    const header = region(container, "header");
    const prototype = enrichedJob.prototype!;
    expect(within(header).getByText(companyInitials(baseJob.company.name))).toHaveAttribute("aria-hidden", "true");
    expect(within(header).getByRole("heading", { level: 1, name: baseJob.title })).toBeVisible();
    for (const text of ["Destacada", "Publicación", prototype.publishedAgoLabel, "Postulantes", prototypeApplicantsLabel(prototype.applicantCount)]) {
      expect(within(header).getByText(text)).toBeVisible();
    }
    // The promotional label is the shared accent Badge, not a raw span recipe,
    // and a promotion is not a lifecycle status, so it never opts into the dot.
    const featured = container.querySelector("[data-detail-flag='featured']") as HTMLElement;
    expect(featured).not.toBeNull();
    expect(featured).toHaveTextContent("Destacada");
    expect(featured).toHaveAttribute("data-slot", "badge");
    expect(featured).toHaveAttribute("data-variant", "accent");
    expect(featured).not.toHaveAttribute("data-dot");
    expect(featured.querySelectorAll("*")).toHaveLength(0);
    expect(viewSource).not.toContain("featuredBadge");
    expect(viewSource).toContain('<Badge variant="accent" data-detail-flag="featured">Destacada</Badge>');
    expect(within(header).queryByRole("note")).toBeNull();
    expect(container.querySelectorAll("article [style]")).toHaveLength(0);
    const classes = [...container.querySelectorAll("article *")].map((node) => node.getAttribute("class") ?? "").join(" ");
    expect(classes).not.toMatch(RAW_COLOR_UTILITY);
  });

  it("renders the four reference stat cards on a two-then-four column grid", () => {
    const { container } = render(<JobDetailView job={enrichedJob} />);
    const prototype = enrichedJob.prototype!;
    const stats = region(container, "stats");
    expect(stats.className).toMatch(/(?:^|\s)grid-cols-2(?:\s|$)/);
    expect(stats.className).toMatch(/lg:grid-cols-4/);
    const expected = [
      ["modality", "Modalidad", workModeLabel(baseJob.work_mode)],
      ["schedule", "Jornada", employmentTypeLabel(baseJob.employment_type)],
      ["level", "Nivel", seniorityLabel(baseJob.seniority)],
      ["area", "Área", prototype.department],
    ] as const;
    for (const [key, label, value] of expected) {
      const card = stat(container, key);
      expect(card.querySelector("dt")?.textContent).toContain(label);
      expect(card.querySelector("dd")?.textContent).toContain(value);
      // Each label carries one decorative icon tile, never a text substitute.
      expect(card.querySelector("dt [aria-hidden='true'] svg")).not.toBeNull();
    }
    // The fixture experience label is a role term, never a wire stat.
    expect(stats).not.toHaveTextContent(prototype.experienceLabel);
  });

  it("keeps the neutral wire-only stats without prototype metrics or disclosure", () => {
    const { container } = render(<JobDetailView job={fullJob} />);
    const header = region(container, "header");
    for (const absent of ["Destacada", "Postulantes"]) expect(within(header).queryByText(absent)).toBeNull();
    expect(within(header).queryByRole("note")).toBeNull();
    expect(stat(container, "area").querySelector("dd")?.textContent).toBe("Sin especificar");
    expect(stat(container, "level").querySelector("dd")?.textContent).toBe(seniorityLabel(fullJob.seniority));
    expect(container.querySelector("article [data-detail-stat='experience']")).toBeNull();
  });

  it("keeps the content column and the rail in one responsive scaffold", () => {
    const { container } = render(<JobDetailView job={fullJob} />);
    const content = region(container, "content");
    const rail = region(container, "rail");
    expect(content.parentElement).toBe(rail.parentElement);
    const scaffold = content.parentElement!.className;
    expect(scaffold).toMatch(/(?:^|\s)grid(?:\s|$)/);
    expect(scaffold).toMatch(/lg:grid-cols-\[minmax\(0,1fr\)_21rem\]/);
    // Below lg the scaffold stays one column: no unscoped column count.
    expect(scaffold).not.toMatch(/(?:^|\s)grid-cols-\d/);
    expect(content).toHaveTextContent("Sobre la vacante");
    expect(rail).toHaveTextContent("Salario");
    expect(container.querySelector("article [data-detail-card='salary']")).not.toBeNull();
  });

  it("keeps long and markup-like wire text as escaped plain text with no new action", () => {
    const longTitle = "Ingeniería de Plataformas de Datos y Observabilidad para la plataformaoperativadedatosyobservabilidadintegraldistribuida";
    const unsafeLocation = "<img src=x onerror=alert(1)> Lugar muy largo sin cortes naturales ni espacios intermedios";
    const job: PrototypeJobView = { ...fullJob, title: longTitle, location: unsafeLocation };
    const { container } = render(<JobDetailView job={job} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole("paragraph")).toHaveLength(1);
    expect(container.querySelectorAll("article img, article script")).toHaveLength(0);
    expect(screen.getByRole("article")).toHaveTextContent(longTitle);
    expect(screen.getByRole("article")).toHaveTextContent(unsafeLocation);
  });

  it("keeps the wire date and the relative label as separate disclosed terms", () => {
    const { container } = render(<JobDetailView job={enrichJob(fullJob)} />);
    const header = region(container, "header");
    const prototype = enrichedJob.prototype!;
    expect(within(header).getByText("Publicada")).toBeVisible();
    expect(within(header).getByText(formatPublishedDate(fullJob.published_at!))).toBeVisible();
    expect(within(header).getByText(prototype.publishedAgoLabel)).toBeVisible();
    // The board browser contract relies on this: the fictional relative label never carries the wire "Publicada" wording, so an enriched vacancy without a wire date publishes no fabricated claim.
    expect(prototype.publishedAgoLabel).not.toMatch(/publicada/i);
  });

  it("stays a server-safe view that forwards only serializable island props", () => {
    expect(viewSource).toMatch(/<article/);
    expect(viewSource).not.toMatch(/["']use client["']|use[A-Z]\w*\(|fetch\(|localStorage|sessionStorage|onClick|onSubmit|style=\{\{|navigator|clipboard|window\.|mailto/u);
    // Every prototype control is the client island: no raw button remains here.
    expect(viewSource).not.toMatch(/<button\b/u);
    expect(viewSource).toContain("./prototype-feedback-island");
    const islands = [...viewSource.matchAll(/<PrototypeFeedbackButton\b[\s\S]*?\/>/gu)].map((match) => match[0]);
    expect(islands).toHaveLength(2);
    for (const island of islands) {
      expect(island).not.toMatch(/=>|function|\{\s*\(/u);
      // React's `key` is a framework slot, not a prop forwarded to the island.
      for (const name of island.matchAll(/(?:^|\s)([a-z][a-zA-Z]*)=/gu)) expect(["key", ...ISLAND_PROPS]).toContain(name[1]);
    }
  });

  it("ships no implementation-status display copy outside comments or identifiers", () => {
    expect(withoutComments(viewSource)).not.toMatch(STATUS_DISPLAY_COPY);
  });
});

describe("JobDetailView reference content and sticky rail (CCP-R4B)", () => {
  const enrichedJob = enrichJob(baseJob);
  const fullJob: JobItem = {
    ...baseJob,
    location: "Monterrey, Nuevo León",
    salary_min: 30000,
    salary_max: 45000,
    published_at: "2026-02-14T09:30:00Z",
  };
  // No prototype enrichment and no matching profile: only wire salary remains.
  const unknownCompany = { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d99", name: "Otra Empresa" };
  const wireOnlySalaryJob: JobItem = {
    ...baseJob,
    company: unknownCompany,
    salary_min: 20000,
    salary_max: 30000,
  };
  const wireOnlyBareJob: JobItem = { ...baseJob, company: unknownCompany };
  const region = (container: HTMLElement, name: string) => {
    const element = container.querySelector<HTMLElement>(`article [data-detail-region='${name}']`);
    if (element === null) throw new Error(`missing detail region: ${name}`);
    return element;
  };
  const card = (container: HTMLElement, name: string) =>
    container.querySelector<HTMLElement>(`article [data-detail-card='${name}']`);

  it("splits requirements, skills, and benefits into reference sections", () => {
    render(<JobDetailView job={enrichedJob} />);
    const prototype = enrichedJob.prototype!;
    for (const label of ["Requisitos", "Habilidades", "Beneficios"]) {
      expect(screen.getByRole("heading", { level: 3, name: label })).toBeVisible();
    }
    for (const label of ["Indispensables", "Deseables"]) {
      expect(screen.getByRole("heading", { level: 4, name: label })).toBeVisible();
    }
    for (const text of [
      ...prototype.requiredRequirements,
      ...prototype.preferredRequirements,
      ...prototype.skills,
      ...prototype.benefits,
    ]) {
      expect(screen.getByText(text)).toBeVisible();
    }
  });

  it("renders every benefit as one token-only tile with a decorative icon", () => {
    const { container } = render(<JobDetailView job={enrichedJob} />);
    const prototype = enrichedJob.prototype!;
    const tiles = [...container.querySelectorAll<HTMLElement>("article [data-benefit-tile]")];
    expect(tiles).toHaveLength(prototype.benefits.length);
    expect(tiles.map((tile) => tile.textContent)).toEqual([...prototype.benefits]);
    for (const tile of tiles) {
      expect(tile.querySelector("[aria-hidden='true'] svg")).not.toBeNull();
    }
    // The tile surfaces are semantic tokens only, never a raw palette utility.
    const classes = [...container.querySelectorAll("article *")].map((node) => node.getAttribute("class") ?? "").join(" ");
    expect(classes).not.toMatch(RAW_COLOR_UTILITY);
  });

  it("builds the desktop sticky rail while the scaffold stacks below lg", () => {
    const { container } = render(<JobDetailView job={enrichedJob} />);
    const rail = region(container, "rail");
    const content = region(container, "content");
    expect(content.parentElement).toBe(rail.parentElement);
    expect(rail.className).toMatch(/lg:sticky/);
    expect(rail.className).toMatch(/lg:top-24/);
    expect(rail.className).toMatch(/lg:self-start/);
    // Below lg the rail stays in normal flow: no unconditional positioning.
    expect(rail.className).not.toMatch(/(?:^|\s)sticky(?:\s|$)/);
    expect(rail.className).not.toMatch(/(?:^|\s)absolute(?:\s|$)/);
  });

  it("renders the real Postularme application link instead of a momentary apply button", () => {
    render(<JobDetailView job={enrichedJob} />);
    const links = screen.getAllByRole("link", { name: "Postularme" });
    expect(links).toHaveLength(1);
    const apply = links[0];
    expect(apply).toHaveAttribute("href", vacancyApplicationHref(enrichedJob.id));
    expect(apply).not.toHaveAttribute("aria-describedby");
    // Token action surface shared by the primary affordance: semantic tokens only.
    expect(apply.className).toMatch(/(?:^|\s)bg-primary\/15(?:\s|$)/);
    expect(apply.className).toMatch(/(?:^|\s)border-primary\/40(?:\s|$)/);
    expect(apply.className).not.toMatch(RAW_COLOR_UTILITY);
    // One decorative arrow trails the label, so the control reads as navigation.
    const icon = apply.querySelector("svg[aria-hidden='true']");
    expect(icon).not.toBeNull();
    expect(apply.lastElementChild).toBe(icon);
    // The demonstration apply button and its momentary confirmation are gone.
    expect(screen.queryByRole("button", { name: /postularme/i })).toBeNull();
    expect(screen.queryByText(/no se envió ninguna postulación real/i)).toBeNull();
  });

  it("keeps the four placeholder controls with clean names, enabled and inert", async () => {
    const user = userEvent.setup();
    render(<JobDetailView job={enrichedJob} />);
    const controls = screen.getAllByRole("button");
    expect(controls.map((control) => control.getAttribute("aria-label"))).toEqual([...DEMO_NAMES]);
    const [save, ...shares] = controls;
    expect([save.getAttribute("aria-pressed"), save.textContent]).toEqual([null, "Guardar"]);
    for (const control of [save, ...shares]) {
      const name = control.getAttribute("aria-label");
      expect([control.matches(":enabled"), control.getAttribute("type"), control.getAttribute("aria-disabled")]).toEqual([true, "button", null]);
      await user.click(control);
      expect([control.getAttribute("aria-label"), control.getAttribute("aria-pressed")]).toEqual([name, null]);
    }
    expect(screen.queryAllByRole("status")).toHaveLength(0);
  });

  it("activates every placeholder control without feedback, navigation, or state", async () => {
    const user = userEvent.setup();
    const before = window.location.href;
    const { container } = render(<JobDetailView job={enrichedJob} />);
    const [save, ...shares] = DEMO_NAMES.map((name) => screen.getByRole("button", { name }));
    for (const control of [save, ...shares]) await user.click(control);
    await user.keyboard("{Enter}");
    expect(container.querySelectorAll("[role='status'], [role='note']")).toHaveLength(0);
    expect(window.location.href).toBe(before);
    expect([save.getAttribute("aria-pressed"), save.getAttribute("aria-label")]).toEqual([null, "Guardar vacante"]);
    expect(shares.map((control) => control.getAttribute("aria-label"))).toEqual(["Copiar enlace", "Compartir en redes", "Enviar por correo"]);
  });

  it("renders the company profile context and canonical link in the rail", () => {
    const { container } = render(<JobDetailView job={enrichedJob} />);
    const company = card(container, "company");
    expect(company).not.toBeNull();
    expect(within(company!).getByText(ACME_PROTOTYPE_PROFILE.companySize)).toBeVisible();
    expect(within(company!).getByText(ACME_PROTOTYPE_PROFILE.location)).toBeVisible();
    const link = within(company!).getByRole("link", { name: `Conoce a ${ACME_PROTOTYPE_PROFILE.name}` });
    expect(link).toHaveAttribute("href", `/empresas/${PROTOTYPE_COMPANY_ID}`);
  });

  it("keeps only the wire salary card for a vacancy without prototype or profile", () => {
    const { container } = render(<JobDetailView job={wireOnlySalaryJob} />);
    const rail = region(container, "rail");
    expect(rail).toHaveTextContent("Salario");
    expect(rail).toHaveTextContent(formatSalary({ min: 20000, max: 30000, currency: "MXN" })!);
    expect(within(rail).queryByRole("button")).toBeNull();
    expect(container.querySelectorAll("article [role='status']")).toHaveLength(0);
    expect(card(container, "company")).toBeNull();
    expect(card(container, "share")).toBeNull();
    expect(card(container, "actions")).toBeNull();
  });

  it("omits the rail entirely when neither salary nor an exact profile resolves", () => {
    const { container } = render(<JobDetailView job={wireOnlyBareJob} />);
    expect(container.querySelector("article [data-detail-region='rail']")).toBeNull();
    expect(region(container, "content")).toHaveTextContent("Sobre la vacante");
  });

  it("keeps the wire-only salary rail when no prototype enrichment exists", () => {
    const { container } = render(<JobDetailView job={fullJob} />);
    expect(card(container, "salary")).not.toBeNull();
    expect(card(container, "actions")).toBeNull();
    expect(card(container, "share")).toBeNull();
  });

  it("keeps actions and share without a salary card when the profile matches but no salary exists", () => {
    const { container } = render(<JobDetailView job={enrichedJob} />);
    expect(card(container, "salary")).toBeNull();
    expect(card(container, "actions")).not.toBeNull();
    expect(card(container, "company")).not.toBeNull();
    expect(card(container, "share")).not.toBeNull();
    expect(region(container, "rail")).toHaveTextContent(prototypeResponseLabel(enrichedJob.prototype!.responseTimeDays));
  });

  it("escapes markup-like benefit text and keeps one decorative icon per tile", () => {
    const unsafeBenefit = "<img src=x onerror=alert(1)>";
    const job: PrototypeJobView = {
      ...enrichedJob,
      prototype: { ...enrichedJob.prototype!, benefits: [unsafeBenefit, "Bono anual"] },
    };
    const { container } = render(<JobDetailView job={job} />);
    const tiles = [...container.querySelectorAll<HTMLElement>("article [data-benefit-tile]")];
    expect(tiles.map((tile) => tile.textContent)).toEqual([unsafeBenefit, "Bono anual"]);
    expect(container.querySelectorAll("article img, article script")).toHaveLength(0);
    for (const tile of tiles) {
      expect(tile.querySelector("[aria-hidden='true'] svg")).not.toBeNull();
    }
  });

  it("scopes the PeopleFlow verification row to the prototype claim", () => {
    const { rerender } = render(<JobDetailView job={enrichedJob} />);
    expect(screen.getByText("Verificada por PeopleFlow")).toBeVisible();
    rerender(<JobDetailView job={{ ...enrichedJob, prototype: { ...enrichedJob.prototype!, verifiedByPeopleFlow: false } }} />);
    expect(screen.queryByText("Verificada por PeopleFlow")).toBeNull();
    rerender(<JobDetailView job={wireOnlyBareJob} />);
    expect(screen.queryByText("Verificada por PeopleFlow")).toBeNull();
  });
});

describe("JobDetailView candidate profile, languages, and application prompts (VDF-1)", () => {
  const enrichedJob = enrichJob(baseJob);
  const prototype = enrichedJob.prototype!;
  const viewSource = readFileSync(join(process.cwd(), "src/features/jobs/components/JobDetailView.tsx"), "utf8");
  const group = (container: HTMLElement, name: string) => {
    const element = container.querySelector<HTMLElement>(`article [data-detail-group='${name}']`);
    if (element === null) throw new Error(`missing detail group: ${name}`);
    return element;
  };

  it("lists each language with its optional CEFR label through the shared Badge", () => {
    const { container } = render(<JobDetailView job={enrichedJob} />);
    const profile = group(container, "profile");
    const languages = profile.querySelector<HTMLElement>("[data-detail-languages]");
    expect(languages).not.toBeNull();
    expect(within(profile).getByRole("heading", { level: 3, name: "Idiomas" })).toBeVisible();
    const badges = [...languages!.querySelectorAll<HTMLElement>("[data-slot='badge']")];
    expect(badges).toHaveLength(prototype.languages!.length);
    for (const badge of badges) {
      expect(badge).toHaveAttribute("data-variant", "outline");
      expect(badge).toHaveTextContent(/^(Español|Inglés)( · [ABC][12])?$/u);
    }
    expect(languages!.textContent).toContain("Inglés · B2");
    expect(languages!.textContent).toContain("Español");
    // A language without a level keeps its name only: no invented proficiency.
    expect(languages!.textContent).not.toContain("Español ·");
  });

  it("renders the application prompts as read-only text with no form control", () => {
    const { container } = render(<JobDetailView job={enrichedJob} />);
    const before = group(container, "before-applying");
    expect(within(before).getByRole("heading", { level: 3, name: "Antes de postularte" })).toBeVisible();
    expect(within(before).getByRole("heading", { level: 4, name: "Preguntas al postularte" })).toBeVisible();
    const questions = before.querySelector<HTMLElement>("[data-detail-questions]");
    expect(questions).not.toBeNull();
    expect(questions!.querySelectorAll("li")).toHaveLength(prototype.applicationQuestions!.length);
    for (const question of prototype.applicationQuestions!) expect(within(before).getByText(question)).toBeVisible();
    expect(container.querySelectorAll("article form, article input, article textarea, article select")).toHaveLength(0);
    expect(container.querySelectorAll("article [role='textbox'], article [role='spinbutton']")).toHaveLength(0);
    expect(withoutComments(viewSource)).not.toMatch(/<input|<textarea|<select|contentEditable/u);
  });

  it("hides the language and prompt blocks when the enrichment has none or blanks", () => {
    const sparse: PrototypeJobView = {
      ...enrichedJob,
      prototype: { ...prototype, languages: [], applicationQuestions: ["   "] },
    };
    const { container } = render(<JobDetailView job={sparse} />);
    expect(screen.queryByRole("heading", { level: 3, name: "Idiomas" })).toBeNull();
    expect(screen.queryByRole("heading", { level: 4, name: "Preguntas al postularte" })).toBeNull();
    expect(container.querySelector("article [data-detail-languages]")).toBeNull();
    expect(container.querySelector("article [data-detail-questions]")).toBeNull();
    // The deadline keeps the before-applying group alive on its own.
    expect(screen.getByRole("heading", { level: 3, name: "Antes de postularte" })).toBeVisible();
  });

  it("drops the before-applying group when neither deadline nor prompts remain", () => {
    const bare: PrototypeJobView = {
      ...enrichedJob,
      prototype: { ...prototype, closingDate: undefined, applicationQuestions: [] },
    };
    const { container } = render(<JobDetailView job={bare} />);
    expect(container.querySelector("article [data-detail-group='before-applying']")).toBeNull();
    expect(screen.queryByRole("heading", { level: 3, name: "Antes de postularte" })).toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "Beneficios" })).toBeVisible();
  });

  it("separates the wire level from the fictional experience label", () => {
    const { container } = render(<JobDetailView job={enrichedJob} />);
    const level = container.querySelector<HTMLElement>("article [data-detail-stat='level']");
    expect(level).not.toBeNull();
    expect(level!.querySelector("dt")?.textContent).toContain("Nivel");
    expect(level!.querySelector("dd")?.textContent).toBe(seniorityLabel(baseJob.seniority));
    expect(container.querySelector("article [data-detail-stat='experience']")).toBeNull();
    const profile = group(container, "profile");
    expect(profile).toHaveTextContent("Experiencia");
    expect(profile).toHaveTextContent(prototype.experienceLabel);
    expect(profile).not.toHaveTextContent(seniorityLabel(baseJob.seniority));
  });

  it("keeps no wire level or experience claim on a vacancy without enrichment", () => {
    render(<JobDetailView job={baseJob} />);
    const level = screen.getByText("Nivel").closest("[data-detail-stat='level']") as HTMLElement;
    expect(level).not.toBeNull();
    expect(level.querySelector("dd")?.textContent).toBe(seniorityLabel(baseJob.seniority));
    expect(screen.queryByText("Experiencia")).toBeNull();
    expect(screen.queryByRole("heading", { level: 3, name: "Idiomas" })).toBeNull();
    expect(screen.queryByRole("heading", { level: 4, name: "Preguntas al postularte" })).toBeNull();
  });

  it("groups the profile, benefits, and before-applying blocks in document order", () => {
    const { container } = render(<JobDetailView job={enrichedJob} />);
    expect(
      [...container.querySelectorAll("article [data-detail-group]")].map((element) => element.getAttribute("data-detail-group")),
    ).toEqual(["profile", "benefits", "before-applying"]);
    const profile = group(container, "profile");
    for (const label of ["Requisitos", "Habilidades", "Idiomas"]) {
      expect(within(profile).getByRole("heading", { level: 3, name: label })).toBeVisible();
    }
    expect(profile.querySelector("[data-detail-languages]")).not.toBeNull();
    const before = group(container, "before-applying");
    expect(before).toHaveTextContent("Cierre de postulaciones");
    expect(before.querySelector("[data-detail-questions]")).not.toBeNull();
  });
});

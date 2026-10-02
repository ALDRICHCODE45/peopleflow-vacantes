import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { JobItem } from "../jobs/types";
import { ACME_PROTOTYPE_JOBS } from "../jobs/prototype-jobs";
import { CompanyCareersView } from "./company-careers-view";
import { emptyCompanySiteContent, siteContentFromProfile } from "./company-site-content";
import { ACME_PROTOTYPE_PROFILE } from "./prototype-companies";

const profile = ACME_PROTOTYPE_PROFILE;
const content = siteContentFromProfile(profile);
const viewSource = readFileSync(join(process.cwd(), "src", "features", "company-profile", "company-careers-view.tsx"), "utf8");
/** Central token sheet, so the hero-scoped contrast contract stays asserted. */
const globalsSource = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
/** Rendered implementation-status vocabulary banned from any visible text. */
const RENDERED_STATUS_COPY = /\b(?:demo|mock|prototip\w*|fictici\w*|prueba|test|local|no disponible|no implementado|no se guarda|no se env[ií]a|no se copi[oó]|no se comparti[oó])\b/iu;
/** Every fictional prototype extra this page must stop rendering. */
const ENRICHMENT_COPY = /Destacada|Verificada por PeopleFlow|postulantes|Responde en|SALARIO MENSUAL|Habilidades|Beneficios/iu;
/** Claim-like or action-like copy this renderer must never invent. */
const FORBIDDEN_COPY = /aplicar|postular|guardar|verificad|popular|recomendad|candidat|opiniones|calificaci|\d+\s*%|\+?\d+\s*(empleados|contrataciones|clientes)/iu;
const view = (jobs: readonly JobItem[] = [], props: Partial<React.ComponentProps<typeof CompanyCareersView>> = {}) =>
  render(<CompanyCareersView content={content} jobs={jobs} {...props} />);
/** The capability rows of the page, scoped so vacancy rows never leak into them. */
const capabilityItems = (container: HTMLElement) =>
  Array.from(container.querySelector("h2#que-hacemos")?.closest("section")?.querySelectorAll("[data-capability-text]") ?? []).map((item) => item.textContent ?? "");

afterEach(() => cleanup());

describe("CompanyCareersView wire text safety", () => {
  it("renders markup-bearing job titles as literal text, never injected elements", () => {
    const title = "<script>alert('xss')</script><img src=x onerror=alert(1)><iframe></iframe><b>Texto</b>";
    view([{ ...ACME_PROTOTYPE_JOBS[0], title }]);
    const row = within(screen.getByRole("list", { name: "Vacantes en Acme" })).getAllByRole("listitem")[0];
    expect(within(row).getByRole("link", { name: title })).toHaveAttribute("href", `/vacantes/${ACME_PROTOTYPE_JOBS[0].id}`);
    expect(row.querySelectorAll("script, img, iframe, b")).toHaveLength(0);
  });
});

describe("CompanyCareersView headings and narrative", () => {
  it("renders one H1 and exactly the three H2 sections in document order", () => {
    view(ACME_PROTOTYPE_JOBS);
    const headings = screen.getAllByRole("heading").filter((node) => node.tagName === "H1" || node.tagName === "H2");
    expect(headings.map((node) => node.tagName)).toEqual(["H1", "H2", "H2", "H2"]);
    expect(headings[0]).toHaveTextContent(profile.name);
    expect(headings.slice(1).map((node) => node.textContent)).toEqual([`Sobre ${profile.name}`, "Qué hacemos", "Vacantes"]);
  });

  it("renders the profile narrative and a list of its own capabilities", () => {
    const { container } = view();
    for (const value of [profile.tagline, profile.about, profile.mission]) expect(container.textContent).toContain(value);
    const highlights = capabilityItems(container);
    expect(highlights.length).toBeGreaterThanOrEqual(3);
    // Every capability row is verbatim profile content, never an invented claim.
    for (const highlight of highlights) expect(profile.whatWeDo.toLowerCase()).toContain(highlight.toLowerCase());
  });

  it("keeps the whole sentence when a profile has nothing to enumerate", () => {
    const whatWeDo = "Operamos bodegas.";
    const { container } = render(<CompanyCareersView content={{ ...content, whatWeDo }} jobs={[]} />);
    expect(capabilityItems(container)).toEqual([whatWeDo]);
  });

  it("lists the profile facts in a description list", () => {
    const { container } = view();
    const descriptionList = container.querySelector("dl");
    expect(Array.from(descriptionList?.querySelectorAll("dt") ?? []).map((term) => term.textContent)).toEqual(["Ubicación", "Tamaño del equipo", "Fundada", "Forma de trabajo"]);
    expect(Array.from(descriptionList?.querySelectorAll("dd") ?? []).map((value) => value.textContent)).toEqual([profile.location, profile.companySize, String(profile.foundedYear), profile.workStyle]);
  });
});

describe("CompanyCareersView hero", () => {
  it("anchors both hero links on real sections at a 40px target with scroll margins", () => {
    const { container } = view();
    const story = screen.getByRole("link", { name: "Conoce la empresa" });
    const vacancies = screen.getByRole("link", { name: "Ver vacantes" });
    expect([story.getAttribute("href"), vacancies.getAttribute("href")]).toEqual(["#sobre-empresa", "#vacantes"]);
    for (const anchor of [story, vacancies]) {
      expect(anchor.tagName).toBe("A");
      expect(anchor.className).toContain("min-h-11");
    }
    for (const id of ["sobre-empresa", "vacantes"]) {
      const target = container.querySelector(`#${id}`);
      expect(target).not.toBeNull();
      expect(target?.className).toContain("scroll-mt");
    }
  });

  it("backs the hero with the shipped local cover and a dark overlay instead of an opaque card", () => {
    const { container } = view();
    const image = container.querySelector("img");
    expect(image?.getAttribute("alt")).toBe(profile.coverPhoto.alt);
    // next/image may serve the byte-identical local file through its optimizer,
    // so the resolved URL only has to point at the asset this repo ships.
    const src = image?.getAttribute("src") ?? "";
    expect(decodeURIComponent(src)).toContain(profile.coverPhoto.url);
    expect(src).not.toMatch(/^(?:https?:)?\/\/|picsum/iu);
    expect(image?.getAttribute("loading")).not.toBe("lazy");
    expect(image?.className).toContain("object-cover");

    const hero = container.querySelector("[data-pf-hero]") as HTMLElement;
    expect(hero).not.toBeNull();
    expect(hero.getAttribute("data-pf-hero-cover")).toBe("true");
    const heroTitle = screen.getByRole("heading", { level: 1 });
    // The copy rides the photo directly: no opaque surface wraps the headline.
    expect(heroTitle.closest("[class*='bg-background'], [class*='bg-card']")).toBeNull();
    // The dark overlay is the copy's own layer, so the scrim is the ancestor that
    // owns the text contrast instead of a detached decorative sibling.
    const overlay = hero.querySelector("[data-pf-hero-overlay]") as HTMLElement;
    expect(overlay).not.toBeNull();
    expect(overlay.className).toContain("pf-hero-overlay");
    expect(heroTitle.className).toContain("pf-hero-title");
    expect(overlay.contains(heroTitle)).toBe(true);
    // Paint comes from the hero-scoped tokens, never raw color or an inline style.
    expect(viewSource).not.toMatch(/bg-(?:black|white)|\brgba?\(|\boklch\(|\bhsl\(/u);
    expect(viewSource).not.toMatch(/style=\{/u);
  });

  it("keeps the identity-only draft on the semantic surface with legible controls", () => {
    const { container } = render(<CompanyCareersView content={emptyCompanySiteContent("Nexo Labs")} jobs={[]} />);

    const hero = container.querySelector("[data-pf-hero]") as HTMLElement;
    expect(hero).not.toBeNull();
    expect(hero.getAttribute("data-pf-hero-cover")).toBe("false");
    expect(hero.querySelector("img")).toBeNull();
    // The no-cover fallback keeps the neutral surface, so the copy stays legible
    // in both themes without borrowing another company's photo.
    expect(hero.className).toContain("bg-secondary");
    const overlay = hero.querySelector("[data-pf-hero-overlay]") as HTMLElement;
    expect(overlay.className).toContain("pf-hero-overlay");
    for (const name of ["Ver vacantes", "Conoce la empresa"]) {
      expect(screen.getByRole("link", { name }).className).toContain("min-h-11");
    }
  });

  it("shows one safe external link and no implementation-status disclosure", () => {
    const { container } = view();
    expect(container.textContent ?? "").not.toMatch(RENDERED_STATUS_COPY);
    expect(container.querySelector("[role='note']")).toBeNull();
    const external = Array.from(container.querySelectorAll("a[href^='http']"));
    expect(external.map((anchor) => [anchor.getAttribute("href"), anchor.getAttribute("target"), anchor.getAttribute("rel")])).toEqual([[profile.website, "_blank", "noopener noreferrer"]]);
  });
});

describe("CompanyCareersView hero contrast tokens", () => {
  const coverSelector = '[data-pf-hero-cover="true"]';
  const coverStart = globalsSource.indexOf(coverSelector);
  const coverBlock = globalsSource.slice(coverStart, globalsSource.indexOf("}", coverStart));
  const baseStart = globalsSource.indexOf(".pf-hero {");
  const baseBlock = globalsSource.slice(baseStart, globalsSource.indexOf("}", baseStart));

  it("keeps the draft on the page's own semantic tokens", () => {
    expect(baseStart).toBeGreaterThanOrEqual(0);
    expect(baseBlock).toContain("--pf-hero-fg: var(--foreground)");
    expect(baseBlock).toContain("--pf-hero-cta-bg: var(--primary)");
  });

  it("keeps the photo overlay light-on-dark in both themes", () => {
    expect(coverStart).toBeGreaterThanOrEqual(0);
    expect(coverBlock).toMatch(/--pf-hero-fg:\s*oklch\(0\.9\d/u);
    expect(coverBlock).toMatch(/--pf-hero-scrim:\s*oklch\(0\.[01]\d/u);
    expect(coverBlock).toMatch(/--pf-hero-cta-bg:\s*oklch\(0\.9\d/u);
    expect(coverBlock).toMatch(/--pf-hero-outline-fg:\s*oklch\(0\.9\d/u);
    // The override is not theme-gated, so both schemes share the same overlay.
    expect(coverBlock).not.toContain("@media");
    expect(coverBlock).not.toContain(".dark");
  });
});

describe("CompanyCareersView preview support", () => {
  it("supports an embedded preview level and id prefix without duplicate ids or a second H1", () => {
    const { container } = view([], { headingLevel: 2, idPrefix: "preview-" });
    expect(container.querySelectorAll("h1")).toHaveLength(0);
    const nameHeading = screen.getByRole("heading", { level: 2, name: profile.name });
    expect(nameHeading.getAttribute("id")).toBe("preview-empresa");
    expect(screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent)).toEqual([`Sobre ${profile.name}`, "Qué hacemos", "Vacantes"]);
    for (const id of ["preview-sobre-empresa", "preview-vacantes"]) expect(container.querySelector(`#${id}`)).not.toBeNull();
    const ids = Array.from(container.querySelectorAll("[id]")).map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the hero anchors pointed at the prefixed ids so a preview never jumps to the public page", () => {
    view([], { headingLevel: 2, idPrefix: "preview-" });
    expect(screen.getByRole("link", { name: "Conoce la empresa" }).getAttribute("href")).toBe("#preview-sobre-empresa");
    expect(screen.getByRole("link", { name: "Ver vacantes" }).getAttribute("href")).toBe("#preview-vacantes");
  });

  it("renders an honest identity-only draft without borrowing the approved profile", () => {
    const { container } = render(<CompanyCareersView content={emptyCompanySiteContent("Nexo Labs")} jobs={[]} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Nexo Labs");
    expect(container.textContent ?? "").not.toMatch(/Acme|montacargas/iu);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Vacantes" })).toBeVisible();
    expect(Array.from(container.querySelectorAll("a")).map((anchor) => anchor.getAttribute("href"))).toContain("/vacantes");
  });
});

describe("CompanyCareersView vacancies", () => {
  it("renders the company's own wire vacancies without any prototype enrichment", () => {
    const { container } = view(ACME_PROTOTYPE_JOBS);
    const list = screen.getByRole("list", { name: `Vacantes en ${profile.name}` });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(ACME_PROTOTYPE_JOBS.length);
    expect(container.textContent ?? "").not.toMatch(ENRICHMENT_COPY);
    expect(container.textContent ?? "").not.toMatch(FORBIDDEN_COPY);
    expect(container.querySelectorAll("[data-prototype-featured], [data-prototype-featured-dot]")).toHaveLength(0);
    expect(within(list).queryAllByRole("button")).toHaveLength(0);
    // The enriched input carries fictional extras; the renderer reads only wire fields.
    expect(ACME_PROTOTYPE_JOBS.some((job) => job.prototype !== undefined)).toBe(true);
    expect(viewSource).not.toMatch(/VacancyCard|prototype|enrich/iu);
  });

  it("links each role to its canonical vacancy page using wire fields only", () => {
    const { container } = view(ACME_PROTOTYPE_JOBS);
    const items = within(screen.getByRole("list", { name: `Vacantes en ${profile.name}` })).getAllByRole("listitem");
    expect(items.map((item) => item.querySelector("h3")?.textContent)).toEqual(ACME_PROTOTYPE_JOBS.map((job) => job.title));
    expect(items.map((item) => Array.from(item.querySelectorAll("a")).map((anchor) => anchor.getAttribute("href")))).toEqual(ACME_PROTOTYPE_JOBS.map((job) => [`/vacantes/${job.id}`, `/vacantes/${job.id}`]));
    // The company name is plain text, and no vacancy links back to the employer route.
    expect(container.querySelectorAll("a[href^='/empresas']")).toHaveLength(0);
    expect(within(items[0]).getByText(profile.name).closest("a")).toBeNull();
    // Wire formatters, never invented labels.
    expect(items[0].textContent).toContain("Remoto");
    expect(items[0].textContent).toContain("Tiempo completo");
    expect(items[0].textContent).toContain("Senior");
    expect(items[0].textContent).toContain("Salario a convenir");
    expect(items[1].textContent).toContain("Híbrido");
    expect(items[1].textContent).toContain("Por contrato");
    expect(items[1].textContent).toContain("Líder");
    expect(items[1].textContent).toContain("MXN 30,000");
  });

  it("keeps the vacancy section an honest placeholder with one board link", () => {
    const { container } = view();
    const vacancySection = container.querySelector("h2#vacantes")?.closest("section");
    expect(vacancySection?.textContent).toMatch(/todavía no lista/iu);
    expect(vacancySection?.textContent).not.toMatch(/prototipo|ficticia|demostraci/iu);
    expect(vacancySection?.textContent).toContain(profile.name);
    expect(Array.from(vacancySection?.querySelectorAll("a") ?? []).map((anchor) => anchor.getAttribute("href"))).toEqual(["/vacantes"]);
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(screen.queryByText(/todavía no lista/iu)).not.toBeNull();
    expect(within(vacancySection as HTMLElement).queryAllByRole("listitem")).toHaveLength(0);
  });
});

describe("CompanyCareersView link contrast", () => {
  /**
   * Both body-sized links of this page must keep theme-aware high-contrast
   * text: WCAG AA needs 4.5:1 for body text, and `text-primary` only reaches
   * ~2.1:1 on the dark page background. The base color must therefore be the
   * semantic `text-foreground` token, which is defined for the light and the
   * dark theme alike, with no theme- or state-scoped color override, and the
   * affordance must be the always-visible underline instead of hover only.
   */
  const FONT_SIZE_TOKENS = new Set(["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl"]);
  const textColorUtilities = (className: string) =>
    className
      .split(/\s+/)
      .filter((utility) => utility.includes("text-"))
      .filter((utility) => !FONT_SIZE_TOKENS.has(utility.slice(utility.lastIndexOf("text-") + 5)));
  const expectHighContrastBodyLink = (link: HTMLElement) => {
    const { className } = link;
    expect(className).toMatch(/(?:^|\s)text-(?:sm|base)(?:\s|$)/);
    const colors = textColorUtilities(className);
    expect(colors.length).toBeGreaterThan(0);
    for (const color of colors) expect(color).toMatch(/^(?:[a-z-]+:)*text-foreground$/);
    expect(className).not.toMatch(/(?:^|\s)(?:[a-z-]+:)*text-primary(?:\/\d+)?(?:\s|$)/);
    expect(className).toMatch(/(?:^|\s)underline(?:\s|$)/);
    expect(className).not.toMatch(/(?:^|\s)no-underline(?:\s|$)/);
    expect(className).toMatch(/focus-visible:outline-ring/);
  };

  it("keeps the board and website links readable in both themes without text-primary", () => {
    view();
    for (const name of [`Sitio web de ${profile.name}`, "Ver vacantes publicadas"]) {
      expectHighContrastBodyLink(screen.getByRole("link", { name }));
    }
  });

  it("keeps a high-contrast website link while the company has its own vacancies", () => {
    view(ACME_PROTOTYPE_JOBS);
    expectHighContrastBodyLink(screen.getByRole("link", { name: `Sitio web de ${profile.name}` }));
  });
});

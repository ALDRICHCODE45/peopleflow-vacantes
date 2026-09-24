import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import type { PrototypeJobView } from "../jobs/enrich";
import { ACME_PROTOTYPE_JOBS } from "../jobs/prototype-jobs";
import { CompanyCareersView } from "./company-careers-view";
import { ACME_PROTOTYPE_PROFILE } from "./prototype-companies";

const profile = ACME_PROTOTYPE_PROFILE;
/** Rendered implementation-status vocabulary banned from any visible text. */
const RENDERED_STATUS_COPY = /\b(?:demo|mock|prototip\w*|fictici\w*|prueba|test|local|no disponible|no implementado|no se guarda|no se env[ií]a|no se copi[oó]|no se comparti[oó])\b/iu;
const view = (jobs: readonly PrototypeJobView[] = []) => render(<CompanyCareersView profile={profile} jobs={jobs} />);
/** The capability list of the page, scoped so vacancy cards never leak into it. */
const capabilityItems = (container: HTMLElement) => Array.from(container.querySelector("h2#que-hacemos")?.closest("section")?.querySelectorAll("li") ?? []).map((item) => item.textContent ?? "");
/** Claim-like or action-like copy this prototype must never render. */
const FORBIDDEN_COPY = /aplicar|postular|guardar|verificad|popular|recomendad|candidat|opiniones|calificaci|\d+\s*%|\+?\d+\s*(empleados|contrataciones|clientes)/iu;
/** Font-size utilities share the `text-` prefix with the color utilities below. */
const FONT_SIZE_TOKENS = new Set(["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl"]);
/** Every text-color utility a class list applies, keeping its variant prefix. */
const textColorUtilities = (className: string) =>
  className
    .split(/\s+/)
    .filter((utility) => utility.includes("text-"))
    .filter((utility) => !FONT_SIZE_TOKENS.has(utility.slice(utility.lastIndexOf("text-") + 5)));

afterEach(() => cleanup());
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
    // Every highlight is verbatim profile content, never an invented claim.
    for (const highlight of highlights) expect(profile.whatWeDo.toLowerCase()).toContain(highlight.toLowerCase());
  });

  it("keeps the whole sentence when a profile has nothing to enumerate", () => {
    const whatWeDo = "Operamos bodegas.";
    const { container } = render(<CompanyCareersView profile={{ ...profile, whatWeDo }} jobs={[]} />);
    expect(capabilityItems(container)).toEqual([whatWeDo]);
  });

  it("lists the profile facts in a description list", () => {
    const { container } = view();
    const descriptionList = container.querySelector("dl");
    expect(Array.from(descriptionList?.querySelectorAll("dt") ?? []).map((term) => term.textContent)).toEqual(["Ubicación", "Tamaño del equipo", "Fundada", "Forma de trabajo"]);
    expect(Array.from(descriptionList?.querySelectorAll("dd") ?? []).map((value) => value.textContent)).toEqual([profile.location, profile.companySize, String(profile.foundedYear), profile.workStyle]);
  });
});

describe("CompanyCareersView media, disclosure, and honesty", () => {
  it("shows one safe external link and no implementation-status disclosure", () => {
    const { container } = view();
    expect(container.textContent ?? "").not.toMatch(RENDERED_STATUS_COPY);
    expect(container.querySelector("[role='note']")).toBeNull();
    const image = container.querySelector("img");
    expect(image?.getAttribute("alt")).toBe(profile.coverPhoto.alt);
    // next/image may serve the byte-identical local file through its optimizer,
    // so the resolved URL only has to point at the asset this repo ships.
    const src = image?.getAttribute("src") ?? "";
    expect(decodeURIComponent(src)).toContain(profile.coverPhoto.url);
    expect(src).not.toMatch(/^(?:https?:)?\/\/|picsum/iu);
    expect([image?.getAttribute("width"), image?.getAttribute("height")]).toEqual(["1600", "900"]);
    expect(image?.getAttribute("sizes")).toBe("(min-width: 1024px) 40vw, 100vw");
    expect(image?.getAttribute("srcset")).toContain(encodeURIComponent(profile.coverPhoto.url));
    expect(image?.className).toContain("object-cover");
    // `priority` keeps the cover from being deferred: it is this route's LCP image.
    expect(image?.getAttribute("loading")).not.toBe("lazy");
    expect(image?.closest("a")).toBeNull();
    expect(image?.parentElement?.className).toContain("bg-muted");
    const external = Array.from(container.querySelectorAll("a[href^='http']"));
    expect(external.map((anchor) => [anchor.getAttribute("href"), anchor.getAttribute("target"), anchor.getAttribute("rel")])).toEqual([[profile.website, "_blank", "noopener noreferrer"]]);
  });

  it("keeps the vacancy section an honest placeholder with one board link", () => {
    const { container } = view();
    expect(FORBIDDEN_COPY.test(container.textContent ?? "")).toBe(false);
    const vacancySection = container.querySelector("h2#vacantes")?.closest("section");
    expect(vacancySection?.textContent).toMatch(/todavía no lista/iu);
    expect(vacancySection?.textContent).not.toMatch(/prototipo|ficticia|demostraci/iu);
    expect(vacancySection?.textContent).toContain(profile.name);
    expect(Array.from(vacancySection?.querySelectorAll("a") ?? []).map((anchor) => anchor.getAttribute("href"))).toEqual(["/vacantes"]);
    expect(container.querySelectorAll("button")).toHaveLength(0);
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

describe("CompanyCareersView vacancies", () => {
  it("lists the company's own prototype vacancies with the reusable card", () => {
    const { container } = view(ACME_PROTOTYPE_JOBS);
    const list = screen.getByRole("list", { name: `Vacantes en ${profile.name}` });
    // The page around the cards still fabricates nothing; the R2/R3 labels the
    // cards carry are scoped by the shared disclosure note checked below.
    const pageText = container.textContent ?? "";
    const cardsText = list.textContent ?? "";
    expect([
      FORBIDDEN_COPY.test(pageText.replace(cardsText, "")),
      FORBIDDEN_COPY.test(cardsText.replaceAll("Verificada por PeopleFlow", "")),
    ]).toEqual([false, false]);
    expect(within(list).queryAllByRole("note")).toHaveLength(0);
    expect([within(list).getAllByText("Destacada").length, within(list).getAllByText("Verificada por PeopleFlow").length]).toEqual([1, 2]);
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(ACME_PROTOTYPE_JOBS.length);
    expect(items.map((item) => item.querySelector("h3")?.textContent)).toEqual(ACME_PROTOTYPE_JOBS.map((job) => job.title));
    expect(items.map((item) => item.querySelector("a")?.getAttribute("href"))).toEqual(ACME_PROTOTYPE_JOBS.map((job) => `/vacantes/${job.id}`));
    for (const item of items) expect(item.querySelector("a")).toHaveTextContent(item.querySelector("h3")?.textContent ?? "");
  });

  it("keeps the company's own name plain text and never links a vacancy back to itself", () => {
    const { container } = view(ACME_PROTOTYPE_JOBS);
    const list = screen.getByRole("list", { name: `Vacantes en ${profile.name}` });
    expect(within(list).getAllByText(profile.name).every((node) => node.closest("a") === null)).toBe(true);
    expect(screen.queryByText(/todavía no lista/iu)).toBeNull();
    expect(Array.from(container.querySelectorAll("a[href^='/empresas']"))).toHaveLength(0);
  });
});

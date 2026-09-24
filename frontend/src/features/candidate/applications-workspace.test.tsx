import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CANDIDATE_APPLICATIONS } from "./prototype-portfolio";
import { ApplicationsWorkspace } from "./applications-workspace";

// Source and global theme tokens as text, so the coupling, tone and side-effect contracts stay asserted here.
const SOURCE = readFileSync(join(process.cwd(), "src/features/candidate/applications-workspace.tsx"), "utf8");
const GLOBALS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|color-mix)\(/u;
/** Strips technical comments so the rendered-copy ban inspects only product strings. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/\/\/[^\n]*/gu, " ");
/** Rendered copy may not expose implementation status; `\b` keeps `localStorage` and data ids intact. */
const IMPLEMENTATION_STATUS_COPY = /\b(?:demo|mock|prototip\w*|fictici\w*|prueba|test|local|no disponible|no implementado|no se guarda|no se env[ií]a|no se sube)\b/iu;
const FILTER_LABELS = ["Todas", "Enviadas", "En revisión", "Contratadas", "Rechazadas"] as const;
const SEARCH_LABEL = "Buscar por puesto o empresa";
const STATUS_TEXT = { submitted: "Enviada", in_review: "En revisión", hired: "Contratada", rejected: "Rechazada" } as const;
const STATUS_VARIANTS = { submitted: "info", in_review: "review", hired: "success", rejected: "danger" } as const;
const STATUS_TOKENS = { submitted: "status-info", in_review: "status-review", hired: "status-success", rejected: "status-danger" } as const;
const block = (pattern: RegExp) => GLOBALS.match(pattern)?.[1] ?? "";
const LIGHT = block(/:root \{\s*color-scheme: light;([\s\S]*?)\n\}/u);
const DARK = block(/\.dark \{([\s\S]*?)\n\}/u);
const SYSTEM_DARK = block(/@media \(prefers-color-scheme: dark\) \{[\s\S]*?:root:not\(\[data-theme\]\) \{([\s\S]*?)\n\}/u);
const rowIds = (container: HTMLElement) => Array.from(container.querySelectorAll("[data-pf-application-row]")).map((node) => node.getAttribute("data-pf-application-row"));
const classesOf = (root: Element) => Array.from(root.querySelectorAll("[class]")).map((node) => node.getAttribute("class") ?? "").join(" ");
const row = (container: HTMLElement, application: (typeof CANDIDATE_APPLICATIONS)[number]) => container.querySelector(`[data-pf-application-row="${application.id}"]`) as HTMLElement;
const ofKind = (container: HTMLElement, kind: string) => Array.from(container.querySelectorAll(`[data-pf-application-presentation="${kind}"]`)) as HTMLElement[];
const cardRoots = (container: HTMLElement) => ofKind(container, "card");
const listItems = (container: HTMLElement) => ofKind(container, "list");
const slot = (root: Element, name: string) => root.querySelector(`[data-slot="${name}"]`) as HTMLElement;
const badge = (root: Element) => slot(root, "badge");
const renderWorkspace = (applications = CANDIDATE_APPLICATIONS) => render(<ApplicationsWorkspace applications={applications} />);
const filter = (name: RegExp) => screen.getByRole("button", { name });
const viewOptions = (container: HTMLElement) => Array.from(container.querySelectorAll("[data-slot='toggle-group-item']")) as HTMLElement[];
const results = (container: HTMLElement) => container.querySelector("[data-pf-applications-results]") as HTMLElement;
const countNode = (container: HTMLElement) => container.querySelector("[data-pf-applications-count]") as HTMLElement;

/**
 * jsdom implements neither matchMedia nor ResizeObserver, and the Base UI menu
 * root reads both while it mounts. Menu open/close itself is not observable
 * through the jsdom portal, so it stays covered by the browser acceptance test.
 */
function stubBrowserApis() {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, media: "", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(() => false) })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
}

beforeEach(stubBrowserApis);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("applications workspace filters", () => {
  it("exposes one labelled InputGroup search and the exact counted, ordered, pressed Button filters", () => {
    const { container } = renderWorkspace();
    expect(container.querySelectorAll("input")).toHaveLength(1);
    expect(screen.getByLabelText(SEARCH_LABEL)).toHaveAttribute("data-pf-applications-search");
    const buttons = Array.from(container.querySelectorAll("[data-pf-applications-filter]")) as HTMLElement[];
    expect(buttons.map((button) => button.getAttribute("data-pf-applications-filter"))).toEqual(["all", "submitted", "in_review", "hired", "rejected"]);
    expect(buttons.map((button) => button.textContent)).toEqual(["Todas4", "Enviadas1", "En revisión1", "Contratadas1", "Rechazadas1"]);
    expect(buttons.map((button) => button.textContent?.replace(/\d+$/u, ""))).toEqual([...FILTER_LABELS]);
    expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false", "false"]);
    for (const button of buttons) expect(button).toHaveAttribute("data-slot", "button");
  });

  it("filters by status and composes it with the diacritic- and case-insensitive search", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    await user.click(filter(/^Enviadas/));
    expect(rowIds(container)).toEqual([CANDIDATE_APPLICATIONS[0].id]);
    expect(filter(/^Enviadas/)).toHaveAttribute("aria-pressed", "true");
    await user.click(filter(/^Todas/));
    const search = screen.getByLabelText(SEARCH_LABEL);
    await user.type(search, "ACME");
    expect(rowIds(container)).toEqual([CANDIDATE_APPLICATIONS[0].id, CANDIDATE_APPLICATIONS[1].id]);
    await user.click(filter(/^Enviadas/));
    expect(rowIds(container)).toEqual([CANDIDATE_APPLICATIONS[0].id]);
    await user.clear(search);
    await user.type(search, "disenadora");
    expect(rowIds(container)).toEqual([]);
    await user.click(filter(/^Todas/));
    expect(rowIds(container)).toEqual([CANDIDATE_APPLICATIONS[3].id]);
  });

  it("orders by updatedAt desc without mutating the props array", () => {
    const reversed = [...CANDIDATE_APPLICATIONS].reverse();
    const before = JSON.stringify(reversed);
    const { container } = renderWorkspace(reversed);
    expect(rowIds(container)).toEqual(CANDIDATE_APPLICATIONS.map((application) => application.id));
    expect(JSON.stringify(reversed)).toBe(before);
    expect(reversed[0].jobTitle).toBe("Diseñadora UX");
  });
});

describe("applications workspace cards view", () => {
  it("renders the four applications as rich vertical shadcn Cards in one mobile column and two desktop columns", () => {
    const { container } = renderWorkspace();
    const cards = cardRoots(container);
    expect(cards).toHaveLength(4);
    expect(rowIds(container)).toEqual(CANDIDATE_APPLICATIONS.map((application) => application.id));
    expect(cards.map((card) => card.getAttribute("data-pf-application-row"))).toEqual(CANDIDATE_APPLICATIONS.map((application) => application.id));
    const grid = container.querySelector("[data-pf-applications-cards]") as HTMLElement;
    expect(grid).not.toBeNull();
    expect(grid.className.split(/\s+/u)).toEqual(expect.arrayContaining(["grid", "grid-cols-1", "lg:grid-cols-2"]));
    expect(cards.every((card) => card.parentElement === grid)).toBe(true);
    for (const [index, card] of cards.entries()) {
      expect(card).toHaveAttribute("data-slot", "card");
      expect(card).toHaveAttribute("data-pf-application-presentation", "card");
      for (const part of ["card-header", "card-title", "card-content", "card-footer"]) expect(slot(card, part), part).not.toBeNull();
      const heading = card.querySelector("[data-slot='card-title'] :is(h1,h2,h3,h4,h5,h6)") as HTMLElement;
      expect([heading.tagName, heading.textContent]).toEqual([expect.stringMatching(/^H[1-6]$/u), CANDIDATE_APPLICATIONS[index].jobTitle]);
      // A vertical card with divided sections and a contextual identity medallion, not a horizontal row.
      expect(card.className, "vertical card").toMatch(/(?:^|\s)flex-col(?:\s|$)/u);
      expect(card.className).not.toContain("flex-row");
      expect(slot(card, "card-header").className).toContain("border-b");
      expect(slot(card, "card-footer").className).toContain("border-t");
      const identity = card.querySelector("[data-pf-application-identity]") as HTMLElement;
      expect(identity, "contextual identity medallion").not.toBeNull();
      expect(identity.className).toContain("rounded-full");
      expect(identity.querySelector("svg"), "functional identity icon").not.toBeNull();
      expect(card.className + " " + classesOf(card)).not.toMatch(/min-h-screen|h-screen|min-h-dvh|h-dvh|min-h-svh|h-svh|min-h-\[|h-\[/u);
    }
  });

  it("composes the card as a divided metadata row, a wrapping cover-letter block and a dated footer with the vacancy action", () => {
    const { container } = renderWorkspace();
    const review = row(container, CANDIDATE_APPLICATIONS[1]);
    const metadata = review.querySelector("[data-pf-application-metadata]") as HTMLElement;
    expect(metadata.tagName).toBe("DL");
    expect(metadata.className.split(/\s+/u)).toEqual(expect.arrayContaining(["grid", "grid-cols-1", "sm:grid-cols-2"]));
    const terms = Array.from(metadata.querySelectorAll("dt"));
    expect(terms.map((term) => term.textContent)).toEqual(["Fuente", "Postulada"]);
    for (const term of terms) expect(term.querySelector("svg"), "functional metadata icon").not.toBeNull();
    const coverLetter = review.querySelector("[data-pf-application-cover-letter]") as HTMLElement;
    const letter = coverLetter.querySelector("dd") as HTMLElement;
    expect(letter).toHaveTextContent(CANDIDATE_APPLICATIONS[1].coverLetter as string);
    expect(letter.className).toContain("line-clamp-4");
    const footer = slot(review, "card-footer");
    // Narrow widths stack the footer; from `sm` it returns to left/right alignment.
    expect(footer.className).toContain("flex-col");
    expect(footer.className).toContain("sm:flex-row");
    expect(footer.className).toContain("sm:justify-between");
    expect(footer.querySelector("time")).toHaveAttribute("datetime", CANDIDATE_APPLICATIONS[1].updatedAt);
    expect(footer.querySelector("a")).toHaveAttribute("href", CANDIDATE_APPLICATIONS[1].publicJobHref);
    // The historical row keeps the honest absence state in the same footer slot.
    const historical = row(container, CANDIDATE_APPLICATIONS[3]);
    expect(historical.querySelector("[data-pf-application-cover-letter] dd")).toHaveTextContent("Sin carta de presentación");
    expect(slot(historical, "card-footer").querySelector("a")).toBeNull();
    expect(slot(historical, "card-footer")).toHaveTextContent("Vacante histórica sin enlace");
  });

  it("keeps every candidate fact, both dates, cover letter and link truth inside the card hierarchy", () => {
    const { container } = renderWorkspace();
    const submitted = row(container, CANDIDATE_APPLICATIONS[0]);
    for (const value of ["Desarrolladora Go", "Acme", "Enviada", "LinkedIn", "5 de marzo de 2026", "Sin carta de presentación"]) expect(submitted).toHaveTextContent(value);
    expect(submitted.querySelectorAll("time")).toHaveLength(2);
    expect(submitted.querySelector("time")).toHaveAttribute("datetime", CANDIDATE_APPLICATIONS[0].createdAt);
    // Frozen route contract: the first `dl dd` of every row is the status text,
    // and the two `<time>` elements are created-then-updated.
    for (const application of CANDIDATE_APPLICATIONS) {
      const item = row(container, application);
      expect(item.querySelector("dl dd")?.textContent).toBe(STATUS_TEXT[application.status]);
      expect(Array.from(item.querySelectorAll("time")).map((node) => node.getAttribute("datetime"))).toEqual([application.createdAt, application.updatedAt]);
    }
    const review = row(container, CANDIDATE_APPLICATIONS[1]);
    for (const value of ["Ingeniera Frontend", "Acme", "En revisión", "Referida", "20 de febrero de 2026", "1 de marzo de 2026", "Me entusiasma construir interfaces accesibles para productos financieros."]) expect(review).toHaveTextContent(value);
    expect(container.querySelectorAll("a")).toHaveLength(2);
    for (const application of CANDIDATE_APPLICATIONS) {
      const card = row(container, application);
      expect([card.closest("a"), card.querySelectorAll("button").length]).toEqual([null, 0]);
      const links = card.querySelectorAll("a");
      if (application.publicJobHref === null) {
        expect(links).toHaveLength(0);
        expect(card).toHaveTextContent("Vacante histórica sin enlace");
      } else {
        expect(links).toHaveLength(1);
        expect(links[0]).toHaveAttribute("href", application.publicJobHref);
        expect(links[0]).toHaveTextContent("Ver vacante");
        expect(links[0]).toHaveAttribute("aria-label", `Ver vacante de ${application.jobTitle} en ${application.companyName}`);
        expect(links[0]).toHaveAttribute("data-slot", "button");
      }
    }
    expect(container.querySelector("a[href='#']")).toBeNull();
  });

  it("maps every application status onto the exact semantic Badge variant with a decorative dot", () => {
    const { container } = renderWorkspace();
    const variants = new Set<string>();
    for (const application of CANDIDATE_APPLICATIONS) {
      const node = badge(row(container, application));
      expect(node).not.toBeNull();
      expect(node).toHaveTextContent(STATUS_TEXT[application.status]);
      expect(node).toHaveAttribute("data-slot", "badge");
      expect(node).toHaveAttribute("data-variant", STATUS_VARIANTS[application.status]);
      expect(node).toHaveAttribute("data-dot");
      expect(node.className).toContain(STATUS_TOKENS[application.status]);
      expect(RAW_COLOR.test(node.className)).toBe(false);
      // The dot is the shared recipe's `::before`, never a manually rendered child.
      expect(node.childNodes).toHaveLength(1);
      expect(node.querySelectorAll("*")).toHaveLength(0);
      variants.add(STATUS_VARIANTS[application.status]);
    }
    expect(variants).toEqual(new Set(["info", "review", "success", "danger"]));
    for (const token of Object.values(STATUS_TOKENS)) {
      expect(GLOBALS).toMatch(new RegExp(`--color-${token}:\\s*var\\(--${token}\\)`, "u"));
      for (const body of [LIGHT, DARK, SYSTEM_DARK]) expect(body, `--${token} definition`).toContain(`--${token}:`);
    }
  });
});

describe("applications workspace view toggle", () => {
  it("exposes a labelled shadcn ToggleGroup with two 40px options and cards selected by default", () => {
    const { container } = renderWorkspace();
    const group = container.querySelector("[data-slot='toggle-group']") as HTMLElement;
    expect(group).not.toBeNull();
    expect(group).toHaveAttribute("role", "group");
    expect(group).toHaveAccessibleName("Vista de postulaciones");
    const options = viewOptions(container);
    expect(options).toHaveLength(2);
    expect(options.map((option) => option.getAttribute("data-pf-applications-view-option"))).toEqual(["cards", "list"]);
    expect(options.map((option) => option.textContent)).toEqual(["Tarjetas", "Lista"]);
    expect(options.map((option) => option.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    for (const option of options) expect(option.className).toContain("min-h-10");
    for (const [index, name] of ["Vista de tarjetas", "Vista de lista"].entries()) expect(options[index]).toHaveAccessibleName(name);
    expect(results(container)).toHaveAttribute("data-pf-applications-view", "cards");
  });

  it("switches views exclusively and never leaves the controlled group without a selected view", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    const [cards, list] = viewOptions(container);
    expect(results(container)).toHaveAttribute("data-pf-applications-view", "cards");
    await user.click(cards);
    expect([cards, list].map((option) => option.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    expect(results(container)).toHaveAttribute("data-pf-applications-view", "cards");
    await user.click(list);
    expect([cards, list].map((option) => option.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    expect(results(container)).toHaveAttribute("data-pf-applications-view", "list");
    await user.click(cards);
    expect([cards, list].map((option) => option.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    expect(results(container)).toHaveAttribute("data-pf-applications-view", "cards");
  });

  it("keeps search, status filtering, newest-first order, filtered IDs and the live count after switching to list", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    const ids = rowIds(container);
    await user.click(screen.getByRole("button", { name: "Vista de lista" }));
    expect(results(container)).toHaveAttribute("data-pf-applications-view", "list");
    expect(cardRoots(container)).toHaveLength(0);
    expect(listItems(container)).toHaveLength(4);
    expect(rowIds(container)).toEqual(ids);
    expect(countNode(container)).toHaveTextContent("Mostrando 4 postulaciones");
    await user.type(screen.getByLabelText(SEARCH_LABEL), "ACME");
    expect(rowIds(container)).toEqual([CANDIDATE_APPLICATIONS[0].id, CANDIDATE_APPLICATIONS[1].id]);
    expect(countNode(container)).toHaveTextContent("Mostrando 2 postulaciones");
    await user.click(filter(/^Enviadas/));
    expect(rowIds(container)).toEqual([CANDIDATE_APPLICATIONS[0].id]);
    expect(countNode(container)).toHaveTextContent("Mostrando 1 postulación");
  });
});

describe("applications workspace list view", () => {
  it("renders four independent outline Item rows inside the semantic list without becoming rich cards", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Vista de lista" }));
    const items = listItems(container);
    expect(items).toHaveLength(4);
    const list = container.querySelector("[data-pf-applications-list]") as HTMLElement;
    expect(list.tagName).toBe("UL");
    // Independent surfaces with real vertical gaps, not one joined rail.
    expect(list.className).toContain("flex-col");
    expect(list.className).toContain("gap-3");
    expect(list.className).not.toContain("divide-y");
    expect(container.querySelector("[data-pf-applications-cards]")).toBeNull();
    // Only the filter surface stays a Card; every row is an official Item.
    expect(container.querySelectorAll("[data-slot='card']")).toHaveLength(1);
    const rows = Array.from(container.querySelectorAll("[data-slot='item']")) as HTMLElement[];
    expect(rows).toHaveLength(4);
    for (const [index, item] of items.entries()) {
      expect(item.tagName).toBe("LI");
      expect(item.parentElement).toBe(list);
      expect(item).not.toHaveAttribute("data-slot", "item");
      const surfaces = Array.from(item.children).filter((node) => node.getAttribute("data-slot") === "item") as HTMLElement[];
      expect(surfaces).toHaveLength(1);
      const surface = surfaces[0];
      expect(surface).toBe(rows[index]);
      expect(surface).toHaveAttribute("data-variant", "outline");
      expect(surface).toHaveAttribute("data-pf-application-row-surface", item.getAttribute("data-pf-application-row") as string);
      for (const token of ["rounded-2xl", "border-border"]) expect(surface.className, token).toContain(token);
      expect(item.querySelector("[data-slot='item-media'] [data-pf-application-identity]")).not.toBeNull();
      expect(item.querySelector("[data-slot='item-content']")).not.toBeNull();
      expect(item.querySelector("[data-slot='item-actions']")).not.toBeNull();
      expect(item.querySelectorAll("[data-slot='card-header'], [data-slot='card-footer'], [data-slot='card-content']")).toHaveLength(0);
      expect(badge(item)).not.toBeNull();
    }
    // ItemGroup groups the rows, while the real `<ul>` keeps the list role: the
    // wrapper must not duplicate `role="list"` over a non-listitem child.
    const group = container.querySelector("[data-slot='item-group']") as HTMLElement;
    expect(group).not.toBeNull();
    expect([group.getAttribute("role"), group.contains(list)]).toEqual(["presentation", true]);
    const submitted = row(container, CANDIDATE_APPLICATIONS[0]);
    for (const value of ["Desarrolladora Go", "Acme", "Enviada", "LinkedIn", "5 de marzo de 2026", "Sin carta de presentación"]) expect(submitted).toHaveTextContent(value);
    const review = row(container, CANDIDATE_APPLICATIONS[1]);
    for (const value of ["Ingeniera Frontend", "En revisión", "Referida", "1 de marzo de 2026", "Me entusiasma construir interfaces accesibles para productos financieros."]) expect(review).toHaveTextContent(value);
  });

  it("scans as one responsive information grid per row with compact icons, a closed-menu boundary and the frozen status contract", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    const statusGroup = screen.getByRole("group", { name: "Filtrar por estado" });
    expect(statusGroup.className).toContain("flex-nowrap");
    expect(statusGroup.className).toContain("overflow-x-auto");
    expect(statusGroup.className).toMatch(/\b(?:md|lg|xl):flex-wrap\b/u);
    expect(statusGroup.className).toMatch(/\b(?:md|lg|xl):overflow(?:-x)?-visible\b/u);
    await user.click(screen.getByRole("button", { name: "Vista de lista" }));
    for (const item of listItems(container)) {
      expect(item.className).toContain("min-w-0");
      const surface = slot(item, "item");
      expect(surface.className).toContain("items-start");
      // The row is the positioning context and the action never takes a flex
      // track, so the information grid keeps the whole mobile row width.
      expect(surface.className).toContain("relative");
      const actions = slot(item, "item-actions");
      expect(actions.className).toContain("absolute");
      expect(actions.className).toContain("sm:static");
      // ItemContent owns one nested responsive information grid inside the row.
      const content = slot(item, "item-content");
      expect(content.className).toContain("min-w-0");
      const grid = content.firstElementChild as HTMLElement;
      expect(grid.className).toContain("grid");
      expect(grid.className).toContain("grid-cols-1");
      expect(grid.className).toMatch(/\blg:grid-cols-/u);
      const terms = Array.from(item.querySelectorAll("dt"));
      expect(terms.map((term) => term.textContent)).toEqual(["Estado", "Fuente", "Postulada", "Actualizada"]);
      for (const term of terms.filter((node) => node.textContent !== "Estado")) expect(term.querySelector("svg"), "functional list icon").not.toBeNull();
      expect(item).toHaveTextContent("Carta de presentación");
    }
    const review = row(container, CANDIDATE_APPLICATIONS[1]);
    expect(slot(review, "item-title")).toHaveTextContent("Ingeniera Frontend");
    expect(slot(review, "item-description")).toHaveTextContent("Acme");
    const coverLetter = CANDIDATE_APPLICATIONS[1].coverLetter as string;
    const cover = Array.from(review.querySelectorAll("span")).find((node) => node.textContent === coverLetter);
    expect(cover, "list cover letter value").toBeDefined();
    // Truncation is a `sm`-and-wider affordance only: a bare `truncate` class
    // would collapse the mobile value to fragments like "Me e…".
    const coverClasses = (cover?.className ?? "").split(/\s+/u);
    expect(coverClasses).toContain("sm:truncate");
    expect(coverClasses).not.toContain("truncate");
    expect(cover).toHaveTextContent(coverLetter);
    const historical = row(container, CANDIDATE_APPLICATIONS[3]);
    expect(historical).toHaveTextContent("Sin carta de presentación");
    // Base UI unmounts closed menu content, so no row renders its vacancy item
    // or a vacancy anchor until that row's own action menu opens.
    expect(historical).not.toHaveTextContent("Vacante histórica sin enlace");
    expect(container.querySelectorAll("a")).toHaveLength(0);
    // Frozen route contract: the first `dl dd` of every row is the status text,
    // and the two `<time>` elements are created-then-updated.
    for (const application of CANDIDATE_APPLICATIONS) {
      const item = row(container, application);
      expect(item.querySelector("dl dd")?.textContent).toBe(STATUS_TEXT[application.status]);
      expect(Array.from(item.querySelectorAll("time")).map((node) => node.getAttribute("datetime"))).toEqual([application.createdAt, application.updatedAt]);
    }
  });

  it("keeps the 375px row readable: the cover letter wraps under its own label and the action stays out of the flex track", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Vista de lista" }));
    const review = row(container, CANDIDATE_APPLICATIONS[1]);
    // Exactly one cell reserves the anchored trigger band, so the cover letter
    // and both dates below it keep the full mobile row width.
    const identity = (review.querySelector("[data-slot='item-title']") as HTMLElement).parentElement as HTMLElement;
    const reserved = Array.from(review.querySelectorAll("[class]")).filter((node) => (node.getAttribute("class") ?? "").split(/\s+/u).includes("pr-14"));
    expect(reserved).toHaveLength(1);
    expect(reserved[0]).toBe(identity);
    expect([identity.className.includes("pr-14"), identity.className.includes("sm:pr-0")]).toEqual([true, true]);
    // The label is its own line and the value wraps below it, until `sm` rejoins them.
    const coverLetter = CANDIDATE_APPLICATIONS[1].coverLetter as string;
    const value = Array.from(review.querySelectorAll("span")).find((node) => node.textContent === coverLetter) as HTMLElement;
    const label = Array.from(review.querySelectorAll("span, p")).find((node) => node.textContent === "Carta de presentación") as HTMLElement;
    const group = label.parentElement as HTMLElement;
    expect(label).not.toBe(value);
    expect([value.parentElement, value.previousElementSibling]).toEqual([group, label]);
    expect([group.className.includes("flex-col"), group.className.includes("sm:flex-row")]).toEqual([true, true]);
    expect(value.className.split(/\s+/u)).toContain("sm:truncate");
    // Both dates stay in their own group outside the reserved cell.
    const dates = group.parentElement?.lastElementChild as HTMLElement;
    expect(dates.tagName).toBe("DL");
    expect(Array.from(dates.querySelectorAll("time")).map((node) => node.getAttribute("datetime"))).toEqual([CANDIDATE_APPLICATIONS[1].createdAt, CANDIDATE_APPLICATIONS[1].updatedAt]);
  });

  it("gives every row one 40px ellipsis trigger with a row-specific name and no mounted menu while closed", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Vista de lista" }));
    const triggers = Array.from(container.querySelectorAll("[data-pf-applications-list] [aria-haspopup='menu']")) as HTMLElement[];
    expect(triggers).toHaveLength(CANDIDATE_APPLICATIONS.length);
    for (const [index, trigger] of triggers.entries()) {
      const application = CANDIDATE_APPLICATIONS[index];
      expect(trigger.tagName).toBe("BUTTON");
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(trigger).toHaveAttribute("aria-label", `Acciones de la postulación de ${application.jobTitle} en ${application.companyName}`);
      expect(trigger.className).toContain("size-10");
      expect(trigger.className).toContain("hover:bg-muted");
      expect(trigger.querySelectorAll("svg")).toHaveLength(1);
      expect(trigger.closest("[data-slot='item-actions']")).not.toBeNull();
      expect(trigger.closest(`[data-pf-application-row="${application.id}"]`)).not.toBeNull();
    }
    // Four row menus plus the five status filters and the two view options.
    expect(container.querySelectorAll("button")).toHaveLength(11);
    expect(container.querySelector("[data-slot='dropdown-menu-content']")).toBeNull();
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
  });

  it("keeps the vacancy truth in the List-only menu source and leaves the card footer treatment alone", () => {
    expect(SOURCE).toContain('from "@/components/ui/item"');
    expect(SOURCE).toContain('from "@/components/ui/dropdown-menu"');
    expect(SOURCE).toMatch(/<ItemGroup role="presentation">/u);
    expect(SOURCE).toMatch(/<ul data-pf-applications-list/u);
    expect(SOURCE).toMatch(/<Item variant="outline"/u);
    for (const part of ["<ItemMedia", "<ItemContent", "<ItemTitle", "<ItemDescription", "<ItemActions"]) expect(SOURCE).toContain(part);
    // Exactly one List-only menu and exactly one direct card-footer vacancy link.
    expect(SOURCE.match(/<ApplicationRowMenu\b/gu)).toHaveLength(1);
    expect(SOURCE.match(/<ApplicationVacancy\b/gu)).toHaveLength(1);
    expect(SOURCE).toMatch(/<DropdownMenuContent align="end" side="bottom"/u);
    expect(SOURCE).toContain("render={<Link href={application.publicJobHref} />}");
    expect(SOURCE.match(/<DropdownMenuItem\b/gu)).toHaveLength(2);
    expect(SOURCE.match(/<DropdownMenuItem disabled/gu)).toHaveLength(1);
    for (const label of ["Ver vacante", "Vacante histórica sin enlace"]) expect(SOURCE).toContain(label);
    for (const icon of ["<Ellipsis aria-hidden=\"true\" />", "<ExternalLink aria-hidden=\"true\" />", "<Link2Off aria-hidden=\"true\" />"]) expect(SOURCE).toContain(icon);
    // The menu exposes no mutation, persistence or invented capability.
    for (const forbidden of ["Retirar", "Cancelar", "clipboard", "share(", "navigator.share"]) expect(SOURCE).not.toContain(forbidden);
  });
});

describe("applications workspace page composition", () => {
  it("leads with the page introduction, one elevated filter surface and a quiet results toolbar above the content", () => {
    const { container } = renderWorkspace();
    const intro = container.querySelector("[data-pf-applications-intro]") as HTMLElement;
    expect(intro.querySelector("h2")).toHaveTextContent("Postulaciones");
    const filters = container.querySelector("[data-pf-applications-filters]") as HTMLElement;
    expect(filters).toHaveAttribute("data-slot", "card");
    expect(filters.querySelector("[data-pf-applications-search]")).not.toBeNull();
    expect(filters.querySelector("[role='group'][aria-label='Filtrar por estado']")).not.toBeNull();
    const toolbar = container.querySelector("[data-pf-applications-toolbar]") as HTMLElement;
    expect(toolbar.querySelector("[data-pf-applications-count]")).not.toBeNull();
    expect(toolbar.querySelector("[data-slot='toggle-group']")).not.toBeNull();
    const order = Array.from(container.querySelectorAll("[data-pf-applications-intro],[data-pf-applications-filters],[data-pf-applications-toolbar],[data-pf-applications-results]"))
      .map((node) => ["intro", "filters", "toolbar", "results"].find((key) => node.hasAttribute(`data-pf-applications-${key}`)));
    expect(order).toEqual(["intro", "filters", "toolbar", "results"]);
  });
});

describe("applications workspace shadcn controls", () => {
  it("composes the search field from shadcn InputGroup with a functional icon and a 40px target", () => {
    const { container } = renderWorkspace();
    const group = container.querySelector("[data-slot='input-group']") as HTMLElement;
    expect(group).not.toBeNull();
    expect(group).toHaveAttribute("role", "group");
    expect(group.className).toContain("h-11");
    const control = group.querySelector("[data-slot='input-group-control']") as HTMLElement;
    expect(control.tagName).toBe("INPUT");
    expect(control).toHaveAttribute("data-pf-applications-search");
    // `h-11` on the group keeps the filled control at or above 40px: the 1px
    // border leaves a 42px inner box for the `h-full` input.
    expect(control.className).toContain("h-full");
    expect(screen.getByLabelText(SEARCH_LABEL)).toBe(control);
    expect(group.querySelector("svg"), "functional search icon").not.toBeNull();
  });

  it("renders filters, clear action and vacancy links through shadcn Button with 40px focus-visible targets", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    const buttons = Array.from(container.querySelectorAll("[data-pf-applications-filter]")) as HTMLElement[];
    expect(buttons).toHaveLength(5);
    for (const button of buttons) {
      expect(button).toHaveAttribute("data-slot", "button");
      expect(button.className).toContain("min-h-10");
      expect(button.className).toContain("focus-visible:ring-3");
    }
    for (const link of Array.from(container.querySelectorAll("a")) as HTMLElement[]) {
      expect(link).toHaveAttribute("data-slot", "button");
      expect(link.className).toContain("min-h-10");
    }
    await user.type(screen.getByLabelText(SEARCH_LABEL), "zzz");
    const clear = container.querySelector("[data-pf-applications-clear]") as HTMLElement;
    expect(clear).toHaveAttribute("data-slot", "button");
    expect(clear.className).toContain("min-h-10");
  });
});

describe("applications workspace results", () => {
  it("keeps the live count in agreement with the rendered rows and natural Spanish pluralization", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    const status = countNode(container);
    expect([status.getAttribute("role"), status.getAttribute("aria-live")]).toEqual(["status", "polite"]);
    expect(status).toHaveTextContent("Mostrando 4 postulaciones");
    await user.type(screen.getByLabelText(SEARCH_LABEL), "acme");
    expect(status).toHaveTextContent("Mostrando 2 postulaciones");
    expect(rowIds(container)).toHaveLength(2);
    await user.click(filter(/^Rechazadas/));
    expect(status).toHaveTextContent("Mostrando 0 postulaciones");
    expect(rowIds(container)).toHaveLength(0);
    cleanup();
    renderWorkspace([CANDIDATE_APPLICATIONS[0]]);
    expect(screen.getByRole("status")).toHaveTextContent("Mostrando 1 postulación");
    cleanup();
    renderWorkspace();
    expect(screen.getByRole("status")).toHaveTextContent("Mostrando 4 postulaciones");
    expect(screen.getByRole("status")).not.toHaveTextContent("1 postulaciones");
  });
});

describe("applications workspace empty states", () => {
  it("recovers a filtered zero state through the shadcn Empty hierarchy and Limpiar filtros", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    await user.type(screen.getByLabelText(SEARCH_LABEL), "zzz");
    const marker = container.querySelector("[data-pf-applications-empty]") as HTMLElement;
    const empty = (marker.matches("[data-slot='empty']") ? marker : marker.querySelector("[data-slot='empty']")) as HTMLElement;
    expect(empty).not.toBeNull();
    for (const part of ["empty-header", "empty-title", "empty-description", "empty-content"]) expect(slot(empty, part), part).not.toBeNull();
    for (const value of ["Sin resultados", "zzz"]) expect(empty).toHaveTextContent(value);
    expect(empty.className).toMatch(/(?:^|\s)(?:p|py|px)-\d/u);
    expect(empty.className).not.toContain("p-12");
    const clear = screen.getByRole("button", { name: "Limpiar filtros" });
    expect([clear.className.includes("min-h-10"), clear.className.includes("focus-visible:ring-3")]).toEqual([true, true]);
    await user.click(clear);
    expect(rowIds(container)).toHaveLength(4);
    expect(screen.getByLabelText(SEARCH_LABEL)).toHaveValue("");
    expect(filter(/^Todas/)).toHaveAttribute("aria-pressed", "true");
  });

  it("names the active status for a filter-only zero state and stays honest with no clear action when there are no applications", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace([CANDIDATE_APPLICATIONS[0]]);
    await user.click(filter(/^Contratadas/));
    expect(container.querySelector("[data-pf-applications-empty]")).toHaveTextContent("No hay postulaciones con el estado Contratada");
    expect(screen.getByRole("button", { name: "Limpiar filtros" })).toBeInTheDocument();
    cleanup();
    const empty = renderWorkspace([]).container;
    expect(empty.querySelector("[data-pf-applications-empty]")).toHaveTextContent("Todavía no tienes postulaciones");
    await user.type(screen.getByLabelText(SEARCH_LABEL), "algo");
    await user.click(filter(/^Enviadas/));
    expect(screen.queryByRole("button", { name: "Limpiar filtros" })).toBeNull();
    expect(rowIds(empty)).toEqual([]);
  });
});

describe("applications workspace contract", () => {
  it("renders no mutation affordance and no implementation-status disclosure", () => {
    const { container } = renderWorkspace();
    expect(screen.queryByRole("note")).toBeNull();
    expect(container.querySelector("[data-pf-applications-disclosure]")).toBeNull();
    expect(container.querySelectorAll("form")).toHaveLength(0);
    // Five status filters plus the two installed ToggleGroup view options.
    expect(container.querySelectorAll("button")).toHaveLength(7);
    expect(container).not.toHaveTextContent(/Retirar|Cancelar postulación/);
  });

  it("keeps token-only paint with one ToggleGroup --gap style allowance and no fixed pixel widths", () => {
    const { container } = renderWorkspace();
    expect(RAW_COLOR.test(classesOf(container))).toBe(false);
    const styled = Array.from(container.querySelectorAll("[style]"));
    expect(styled).toHaveLength(1);
    expect(styled[0]).toHaveAttribute("data-slot", "toggle-group");
    expect(styled[0].getAttribute("style")).toMatch(/^--gap:\s*\d+;?$/u);
    expect(SOURCE).not.toMatch(/w-\[\d+px\]/u);
  });

  it("stays a local client surface over props with only the approved primitives and no fixture, network, router or side effect", () => {
    expect(SOURCE).toMatch(/^\s*["']use client["']/mu);
    const modules = [...new Set([...SOURCE.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]))].sort();
    // Only the approved shadcn primitives, the search icon and the local model are allowed.
    expect(modules).toEqual(["./portfolio-model", "@/components/ui/badge", "@/components/ui/button", "@/components/ui/card", "@/components/ui/dropdown-menu", "@/components/ui/empty", "@/components/ui/input-group", "@/components/ui/item", "@/components/ui/toggle-group", "lucide-react", "next/link", "react"]);
    expect(SOURCE).toMatch(/<ToggleGroup\b/u);
    expect(SOURCE).toMatch(/<ToggleGroupItem\b/u);
    for (const view of ['value="cards"', 'value="list"']) expect(SOURCE, `applications-workspace.tsx must declare ${view}`).toContain(view);
    for (const forbidden of ["prototype-", "CANDIDATE_APPLICATIONS", "@/features/", "fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB", "navigator.", "useRouter", "next/navigation", "onDrag", "draggable", "<form", "useEffect", "setTimeout", "setInterval", "Math.random", "Date.now", "window.", "formatDistance", "reverse()", "shift()"]) {
      expect(SOURCE, `applications-workspace.tsx must not declare ${forbidden}`).not.toContain(forbidden);
    }
    // Rendered copy must stay product-facing: no implementation-status disclosure.
    expect(IMPLEMENTATION_STATUS_COPY.test(stripComments(SOURCE))).toBe(false);
    expect(SOURCE).not.toContain("data-pf-applications-disclosure");
    // The semantic mapping replaced the duplicated local tone recipe.
    expect(SOURCE).toContain("type BadgeVariant");
    expect(SOURCE).toMatch(/STATUS_VARIANT: Readonly<Record<ApplicationStatus, BadgeVariant>>/u);
    expect(SOURCE).toContain("<Badge variant={STATUS_VARIANT[status]} dot>");
    expect(SOURCE).not.toContain("STATUS_TONE");
    for (const token of Object.values(STATUS_TOKENS)) expect(SOURCE, token).not.toContain(`border-${token}/40`);
  });

  it("centers the workspace on the approved profile measure with a single padding owner", () => {
    const { container } = renderWorkspace();
    const root = container.querySelector("[data-pf-applications-workspace]") as HTMLElement;
    const tokens = root.className.split(/\s+/u);
    expect(["mx-auto", "w-full", "max-w-screen-2xl"].filter((token) => !tokens.includes(token))).toEqual([]);
    expect(["px-4", "py-4", "lg:px-6"].filter((token) => !tokens.includes(token))).toEqual([]);
    const owners = Array.from(container.querySelectorAll("[class]")).filter((node) => {
      const value = (node.getAttribute("class") ?? "").split(/\s+/u);
      return value.includes("px-4") && value.includes("lg:px-6");
    });
    expect(owners).toHaveLength(1);
    expect(owners[0]).toBe(root);
  });
});

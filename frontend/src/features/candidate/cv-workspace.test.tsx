import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CANDIDATE_CVS } from "./prototype-portfolio";
import { CvWorkspace } from "./cv-workspace";

// Source as text, so the module boundary, side-effect ban and paint contract stay asserted here.
const SOURCE = readFileSync(join(process.cwd(), "src/features/candidate/cv-workspace.tsx"), "utf8");
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|color-mix)\(/u;
const [PRIMARY, SECONDARY] = CANDIDATE_CVS;
/** Strips technical comments so the rendered-copy ban inspects only product strings. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/\/\/[^\n]*/gu, " ");
/** Rendered copy may not expose implementation status; `\b` keeps `localStorage` and data ids intact. */
const IMPLEMENTATION_STATUS_COPY = /\b(?:demo|mock|prototip\w*|fictici\w*|prueba|test|local|no disponible|no implementado|no se guarda|no se env[ií]a|no se sube)\b/iu;
// Frozen-fixture derivations used only to exercise the remaining deterministic branches.
const older = { ...SECONDARY, id: "cv-archivo", fileName: "cv-archivo.pdf", updatedAt: "2026-01-01T10:00:00-06:00" };
const tieA = { ...SECONDARY, id: "cv-a", fileName: "cv-a.pdf" };
const tieB = { ...SECONDARY, id: "cv-b", fileName: "cv-b.pdf" };
const withoutPrimary = CANDIDATE_CVS.map((cv) => ({ ...cv, isPrimary: false }));
const buttons = (container: HTMLElement) => Array.from(container.querySelectorAll("button")) as HTMLButtonElement[];
const cardIds = (container: HTMLElement) => Array.from(container.querySelectorAll("[data-pf-cv-card]")).map((node) => node.getAttribute("data-pf-cv-card"));
const card = (container: HTMLElement, id: string) => container.querySelector(`[data-pf-cv-card="${id}"]`) as HTMLElement;
const classesOf = (root: Element) => Array.from(root.querySelectorAll("[class]")).map((node) => node.getAttribute("class") ?? "").join(" ");
const renderWorkspace = (cvs = CANDIDATE_CVS) => render(<CvWorkspace cvs={cvs} />);
const triggers = (container: HTMLElement) => Array.from(container.querySelectorAll("[data-pf-cv-actions-trigger]")) as HTMLButtonElement[];

/**
 * jsdom implements neither matchMedia nor ResizeObserver, and the Base UI menu
 * root reads both while it mounts. Menu open/close itself is not observable
 * through the jsdom portal, so this file asserts the closed trigger inventory and
 * the source contract; the real open-menu keyboard semantics stay in the browser
 * acceptance test.
 */
function stubBrowserApis() {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, media: "", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(() => false) })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
}

beforeEach(stubBrowserApis);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("cv workspace summary", () => {
  it("derives a natural count from props and names the exact primary label and filename", () => {
    const { container } = renderWorkspace();
    expect(container.querySelectorAll("[data-pf-cv-card]")).toHaveLength(2);
    const summary = container.querySelector("[data-pf-cv-summary]") as HTMLElement;
    expect(summary).toHaveTextContent("Tienes 2 CVs.");
    expect(summary).toHaveTextContent(`«${PRIMARY.label}»`);
    expect(summary).toHaveTextContent(`(${PRIMARY.fileName})`);
    expect(summary).not.toHaveTextContent(SECONDARY.fileName);
  });

  it("uses the natural Spanish singular for exactly one CV", () => {
    renderWorkspace([PRIMARY]);
    expect(screen.getByText(/Tienes 1 CV\./u)).toBeInTheDocument();
    expect(screen.queryByText(/1 CVs/u)).toBeNull();
  });

  it("covers the honest no-primary and true-empty branches without an impossible claim", () => {
    renderWorkspace(withoutPrimary);
    expect(screen.getByText(/ninguno está marcado como principal/u)).toBeInTheDocument();
    expect(screen.queryByText(/Tu CV principal es/u)).toBeNull();
    cleanup();
    renderWorkspace([]);
    expect(screen.getByText("Todavía no tienes CVs.")).toBeInTheDocument();
    expect(screen.queryByText(/marcado como principal/u)).toBeNull();
    expect(screen.queryByText(/Tu CV principal es/u)).toBeNull();
  });
});

describe("cv workspace ordering", () => {
  it("copies props, puts the primary first, then updatedAt desc, and never mutates the input", () => {
    const reversed = [...CANDIDATE_CVS].reverse();
    const before = JSON.stringify(reversed);
    const { container } = renderWorkspace(reversed);
    expect(cardIds(container)).toEqual([PRIMARY.id, SECONDARY.id]);
    expect(JSON.stringify(reversed)).toBe(before);
    expect(reversed[0].isPrimary).toBe(false);
    expect(reversed[0].id).toBe(SECONDARY.id);
  });

  it("orders secondary CVs by updatedAt desc and falls back to a stable id tie", () => {
    const byDate = renderWorkspace([older, SECONDARY, PRIMARY]);
    expect(cardIds(byDate.container)).toEqual([PRIMARY.id, SECONDARY.id, older.id]);
    cleanup();
    const byTie = renderWorkspace([PRIMARY, tieB, tieA]);
    expect(cardIds(byTie.container)).toEqual([PRIMARY.id, tieA.id, tieB.id]);
  });
});

describe("cv workspace cards", () => {
  it("renders the exact language, Spanish UTC date, KB size, PDF format and primary role", () => {
    const { container } = renderWorkspace();
    const primaryCard = card(container, PRIMARY.id);
    for (const value of [PRIMARY.label, PRIMARY.fileName, "Rol", "Principal", "Español", "10 de marzo de 2026", "340 KB", "PDF"]) expect(primaryCard).toHaveTextContent(value);
    const secondaryCard = card(container, SECONDARY.id);
    for (const value of [SECONDARY.label, SECONDARY.fileName, "Secundario", "Inglés", "18 de febrero de 2026", "291 KB", "PDF"]) expect(secondaryCard).toHaveTextContent(value);
    expect(primaryCard.querySelectorAll("dl")).toHaveLength(1);
    expect(primaryCard.querySelectorAll("dt")).toHaveLength(5);
  });

  it("renders a deterministic one-decimal MB size for large documents", () => {
    const large = { ...PRIMARY, id: "cv-grande", fileName: "cv-grande.pdf", sizeBytes: 2_621_440 };
    const { container } = renderWorkspace([large]);
    expect(card(container, large.id)).toHaveTextContent("2.5 MB");
    expect(card(container, large.id)).not.toHaveTextContent("KB");
  });
});

describe("cv workspace actions", () => {
  it("renders exactly one enabled upload document action and no direct per-card action", () => {
    const { container } = renderWorkspace();
    expect(container.querySelectorAll("[data-pf-cv-upload]")).toHaveLength(1);
    const upload = container.querySelector("[data-pf-cv-upload]") as HTMLButtonElement;
    expect([upload.tagName, upload.getAttribute("type"), upload.disabled, upload.getAttribute("onclick")]).toEqual(["BUTTON", "button", false, null]);
    expect(upload.className).toContain("min-h-10");
    expect(upload.querySelector("svg.lucide-upload")).not.toBeNull();
    for (const hook of ["[data-pf-cv-replace]", "[data-pf-cv-download]", "[data-pf-cv-make-primary]"]) {
      expect(container.querySelectorAll(hook)).toHaveLength(0);
    }
    // One upload plus the two disclosure triggers.
    expect(buttons(container)).toHaveLength(3);
    expect(container.querySelectorAll("form")).toHaveLength(0);
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(container.querySelectorAll("[onclick]")).toHaveLength(0);
  });

  it("gives every CV one enabled 40px disclosure trigger with a row-specific name", () => {
    const { container } = renderWorkspace();
    const opened = triggers(container);
    expect(opened).toHaveLength(2);
    expect(opened.map((trigger) => trigger.getAttribute("data-pf-cv-actions-trigger"))).toEqual([PRIMARY.id, SECONDARY.id]);
    expect(opened.map((trigger) => trigger.getAttribute("aria-label"))).toEqual([`Acciones de ${PRIMARY.label}`, `Acciones de ${SECONDARY.label}`]);
    expect(new Set(opened.map((trigger) => trigger.getAttribute("aria-label"))).size).toBe(opened.length);
    for (const trigger of opened) {
      expect([trigger.tagName, trigger.getAttribute("type"), trigger.disabled, trigger.getAttribute("onclick")]).toEqual(["BUTTON", "button", false, null]);
      expect(trigger).toHaveAttribute("aria-haspopup", "menu");
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(trigger.className).toContain("size-10");
      expect(trigger.className).toContain("hover:bg-muted");
      expect(trigger.querySelectorAll("svg")).toHaveLength(1);
      expect(trigger.querySelector("svg.lucide-ellipsis")).not.toBeNull();
      expect(trigger.closest("[data-slot='card-action']")).not.toBeNull();
      expect(trigger.closest("[data-slot='card-header']")).not.toBeNull();
      expect(trigger.closest("[data-pf-cv-card]")).not.toBeNull();
    }
  });

  it("keeps every menu closed on render with no mounted menu surface or menuitem", () => {
    const { container } = renderWorkspace();
    expect(container.querySelector("[data-slot='dropdown-menu-content']")).toBeNull();
    expect(container.querySelectorAll("[data-slot='dropdown-menu-item']")).toHaveLength(0);
    expect(container.querySelectorAll("[data-pf-cv-replace], [data-pf-cv-download], [data-pf-cv-make-primary]")).toHaveLength(0);
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
  });
});

describe("cv workspace empty state", () => {
  it("stays honest with zero cards and an enabled upload action", () => {
    const { container } = renderWorkspace([]);
    expect(container.querySelectorAll("[data-pf-cv-card]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-pf-cv-list]")).toHaveLength(0);
    expect(container.querySelector("[data-pf-cv-summary]")).toHaveTextContent("Todavía no tienes CVs");
    expect(screen.getByRole("button", { name: "Subir CV" })).toBeEnabled();
    expect(container).not.toHaveTextContent(/Tu CV principal es/u);
  });
});

describe("cv workspace composition contract", () => {
  it("composes the installed Card anatomy with a real heading and list semantics per CV", () => {
    const { container } = renderWorkspace();
    const list = container.querySelector("[data-pf-cv-list]") as HTMLElement;
    expect(list.tagName).toBe("UL");
    for (const cv of [PRIMARY, SECONDARY]) {
      const cvCard = card(container, cv.id);
      expect(cvCard.getAttribute("data-slot")).toBe("card");
      expect(cvCard.parentElement?.tagName).toBe("LI");
      expect(cvCard.querySelector('[data-slot="card-header"]')).not.toBeNull();
      expect(cvCard.querySelector('[data-slot="card-content"]')).not.toBeNull();
      expect(cvCard.querySelector('[data-slot="card-footer"]')).toBeNull();
      const action = cvCard.querySelector('[data-slot="card-action"]') as HTMLElement;
      expect(action).not.toBeNull();
      expect(action.parentElement?.getAttribute("data-slot")).toBe("card-header");
      expect(action.querySelector("[data-pf-cv-actions-trigger]")).not.toBeNull();
      expect(cvCard.lastElementChild?.getAttribute("data-slot")).toBe("card-content");
      expect(screen.getByRole("heading", { level: 3, name: cv.label })).toHaveTextContent(cv.label);
    }
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
    expect(screen.getByRole("heading", { level: 2, name: "Tus CVs" })).toBeInTheDocument();
  });

  it("marks the role with an installed Badge whose Spanish word, not only its tone, distinguishes it", () => {
    const { container } = renderWorkspace();
    const badgesOf = (id: string) => Array.from(card(container, id).querySelectorAll('[data-slot="badge"]')) as HTMLElement[];
    expect(badgesOf(PRIMARY.id)).toHaveLength(1);
    expect(badgesOf(SECONDARY.id)).toHaveLength(1);
    expect(badgesOf(PRIMARY.id)[0]).toHaveTextContent("Principal");
    expect(badgesOf(SECONDARY.id)[0]).toHaveTextContent("Secundario");
    expect(badgesOf(PRIMARY.id)[0].getAttribute("data-variant")).toBe("accent");
    expect(badgesOf(SECONDARY.id)[0].getAttribute("data-variant")).toBe("neutral");
    // A role is not a lifecycle status, so neither badge opts into the decorative dot.
    for (const badge of [...badgesOf(PRIMARY.id), ...badgesOf(SECONDARY.id)]) {
      expect(badge).not.toHaveAttribute("data-dot");
      expect(badge.querySelectorAll("*")).toHaveLength(0);
    }
    // The saturated filled role tone and the outline metadata recipe are gone.
    expect(SOURCE).toContain('variant={isPrimary ? "accent" : "neutral"}');
    expect(SOURCE).not.toMatch(/variant=\{isPrimary \? "default"/u);
    expect(SOURCE).not.toMatch(/<Badge[^>]*\bdot\b/u);
  });

  it("gives the document identity, every fact label and every disclosure trigger a contextual lucide icon", () => {
    const { container } = renderWorkspace();
    for (const cv of [PRIMARY, SECONDARY]) {
      const cvCard = card(container, cv.id);
      expect(cvCard.querySelector('[data-slot="card-header"] svg.lucide-file-text')).not.toBeNull();
      const terms = Array.from(cvCard.querySelectorAll("dt"));
      expect(terms).toHaveLength(5);
      for (const term of terms) expect(term.querySelector("svg")).not.toBeNull();
    }
    expect(card(container, PRIMARY.id).querySelector("svg.lucide-star")).not.toBeNull();
    for (const trigger of triggers(container)) expect(trigger.querySelector("svg.lucide-ellipsis")).not.toBeNull();
    expect(container.querySelector('[data-pf-cv-upload] svg.lucide-upload')).not.toBeNull();
    // The disabled menu icons live inside the unmounted portal, so source holds them.
    for (const icon of ["<Ellipsis aria-hidden=\"true\" />", "<RefreshCw aria-hidden=\"true\" />", "<Download aria-hidden=\"true\" />", "<Star aria-hidden=\"true\" />"]) expect(SOURCE).toContain(icon);
    const icons = Array.from(container.querySelectorAll("svg"));
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) expect(icon.getAttribute("aria-hidden")).toBe("true");
  });

  it("contracts one installed menu per CV with two or three inert items and no footer", () => {
    const { container } = renderWorkspace();
    expect(container.querySelectorAll("[data-slot='card-footer']")).toHaveLength(0);
    expect(container.querySelectorAll("[data-pf-cv-card-actions]")).toHaveLength(0);
    expect(SOURCE).toContain('from "@/components/ui/card"');
    expect(SOURCE).toContain("CardAction");
    expect(SOURCE).toContain('from "@/components/ui/dropdown-menu"');
    expect(SOURCE).not.toContain("CardFooter");
    expect(SOURCE).not.toContain("card-footer");
    expect(SOURCE.match(/<CvActionsMenu\b/gu)).toHaveLength(1);
    expect(SOURCE.match(/<DropdownMenu\b/gu)).toHaveLength(1);
    expect(SOURCE.match(/<DropdownMenuTrigger\b/gu)).toHaveLength(1);
    expect(SOURCE.match(/<DropdownMenuContent\b/gu)).toHaveLength(1);
    expect(SOURCE.match(/<DropdownMenuGroup\b/gu)).toHaveLength(1);
    expect(SOURCE.match(/<DropdownMenuItem\b/gu)).toHaveLength(3);
    expect(SOURCE.match(/<DropdownMenuItem disabled/gu)).toBeNull();
    expect(SOURCE.match(/className=\{MENU_ITEM\}/gu)).toHaveLength(3);
    expect(SOURCE).toMatch(/<DropdownMenuContent align="end" side="bottom"/u);
    // Exactly one conditional definition: the primary CV keeps two items, every secondary gains the third.
    expect(SOURCE.match(/\{cv\.isPrimary \? null : \(/gu)).toHaveLength(1);
    for (const hook of ["data-pf-cv-replace", "data-pf-cv-download", "data-pf-cv-make-primary"]) {
      expect(SOURCE.match(new RegExp(hook, "gu"))).toHaveLength(1);
    }
    for (const label of ["Reemplazar", "Descargar", "Usar como principal"]) expect(SOURCE).toContain(label);
    expect(SOURCE).not.toContain("(no disponible)");
    expect(SOURCE).toContain("aria-label={`Acciones de ${cv.label}`}");
  });

  it("keeps the empty branch on the installed Empty primitive with no list and no card", () => {
    const { container } = renderWorkspace([]);
    const empty = container.querySelector('[data-slot="empty"]') as HTMLElement;
    expect(empty).not.toBeNull();
    expect(empty.querySelector('[data-slot="empty-icon"]')).not.toBeNull();
    expect(empty.querySelector('[data-slot="empty-title"]')).toHaveTextContent("Sin CVs");
    expect(empty.querySelector('[data-slot="empty-description"]')).not.toHaveTextContent(/Tu CV principal es/u);
    expect(container.querySelector("[data-pf-cv-list]")).toBeNull();
    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Subir CV" })).toBeEnabled();
  });

  it("stacks and splits the document grid while the header keeps the trigger beside natural wrapping filenames", () => {
    const { container } = renderWorkspace();
    const list = container.querySelector("[data-pf-cv-list]") as HTMLElement;
    expect([list.className.includes("grid-cols-1"), list.className.includes("lg:grid-cols-2")]).toEqual([true, true]);
    expect(list.className).toContain("items-start");
    for (const cv of [PRIMARY, SECONDARY]) {
      const cvCard = card(container, cv.id);
      const header = cvCard.querySelector('[data-slot="card-header"]') as HTMLElement;
      expect(header.className).toContain("border-b");
      expect(header.querySelector("[data-slot='card-action'] [data-pf-cv-actions-trigger]")).not.toBeNull();
      expect(cvCard.className).not.toContain("h-full");
    }
    const filename = container.querySelector(`[data-pf-cv-filename="${SECONDARY.id}"]`) as HTMLElement;
    expect(filename.className).toContain("break-words");
    expect(filename.className).not.toContain("break-all");
    expect(filename.closest(".min-w-0")).not.toBeNull();
    expect(SOURCE).not.toContain("break-all");
  });

  it("centers the workspace on the approved full width with a single padding owner and no inner width cap", () => {
    const { container } = renderWorkspace();
    const root = container.querySelector("[data-pf-cv-workspace]") as HTMLElement;
    const tokens = root.className.split(/\s+/u);
    expect(["mx-auto", "w-full", "max-w-screen-2xl"].filter((token) => !tokens.includes(token))).toEqual([]);
    expect(["px-4", "py-4", "md:py-6", "lg:px-6"].filter((token) => !tokens.includes(token))).toEqual([]);
    const owners = Array.from(container.querySelectorAll("[class]")).filter((node) => {
      const value = (node.getAttribute("class") ?? "").split(/\s+/u);
      return value.includes("px-4") && value.includes("lg:px-6");
    });
    expect(owners).toHaveLength(1);
    expect(owners[0]).toBe(root);
    // The canonical `max-w-screen-2xl` measure now travels through the shared
    // page-content wrapper prop, so the workspace source declares none of its
    // own and still cannot introduce a narrower inner cap.
    expect([...SOURCE.matchAll(/max-w-[a-z0-9-]+/gu)].map((match) => match[0])).toEqual([]);
  });

  it("paints only with semantic tokens inside the workspace", () => {
    const { container } = renderWorkspace();
    expect(RAW_COLOR.test(classesOf(container))).toBe(false);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
    expect(SOURCE).not.toContain("bg-card/40");
    expect(SOURCE).not.toContain("dark:");
    expect(SOURCE).not.toMatch(RAW_COLOR);
    expect(SOURCE).not.toMatch(/space-[xy]-/u);
    expect(SOURCE).not.toMatch(/[wh]-\[\d/u);
    expect(SOURCE).not.toMatch(/(?<![\w-])h-\d/u);
  });
});

describe("cv workspace source contract", () => {
  it("stays a props-only server surface limited to the installed UI, model and icon modules", () => {
    const modules = [...new Set([...SOURCE.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]))].sort();
    expect(modules).toEqual([
      "./portfolio-model",
      "@/components/dashboard-page-content",
      "@/components/ui/badge",
      "@/components/ui/button",
      "@/components/ui/card",
      "@/components/ui/dropdown-menu",
      "@/components/ui/empty",
      "lucide-react",
    ]);
    const lucideNames = [...SOURCE.matchAll(/import \{([^}]*)\} from "lucide-react"/gu)]
      .flatMap((match) => match[1].split(",").map((name) => name.trim()).filter((name) => name !== ""))
      .sort();
    expect(lucideNames).toEqual(["CalendarClock", "Download", "Ellipsis", "FileText", "FileType2", "HardDrive", "Languages", "RefreshCw", "Star", "Upload"]);
    expect(SOURCE).not.toMatch(/["']use client["']/u);
    for (const forbidden of [
      "@/features/", "prototype-", "CANDIDATE_CVS",
      "fetch(", "XMLHttpRequest", "axios", "localStorage", "sessionStorage", "indexedDB",
      "navigator.", "window.", "document.", "useRouter", "next/navigation", "next/link", "next/router",
      "onClick", "onChange", "onSubmit", "onDrag", "draggable", "<form", "<input", "<a ", "href=",
      "downloadUrl", "createObjectURL", "useEffect", "useState", "setTimeout", "setInterval",
      "requestAnimationFrame", "Math.random", "Date.now", "crypto.", "randomUUID", "generated",
    ]) expect(SOURCE, `cv-workspace.tsx must not contain ${forbidden}`).not.toContain(forbidden);
    // Rendered copy must stay product-facing: no implementation-status disclosure.
    expect(IMPLEMENTATION_STATUS_COPY.test(stripComments(SOURCE))).toBe(false);
    for (const hook of ["data-pf-cv-disclosure", "data-pf-cv-actions-note", "pf-cv-actions-note"]) expect(SOURCE).not.toContain(hook);
  });
});

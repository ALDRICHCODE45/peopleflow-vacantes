import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CANDIDATE_CVS } from "./prototype-portfolio";
import { CvWorkspace } from "./cv-workspace";

// Source as text, so the coupling and side-effect contract stays asserted here.
const SOURCE = readFileSync(join(process.cwd(), "src/features/candidate/cv-workspace.tsx"), "utf8");
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|color-mix)\(/u;
const [PRIMARY, SECONDARY] = CANDIDATE_CVS;
const NOTE_ID = "pf-cv-actions-note";
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
afterEach(cleanup);

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
    expect(screen.getByText("Todavía no tienes CVs en esta demo local.")).toBeInTheDocument();
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
  it("renders exactly one disabled upload button plus the per-card disabled inventory", () => {
    const { container } = renderWorkspace();
    expect(container.querySelectorAll("[data-pf-cv-upload]")).toHaveLength(1);
    expect(buttons(container).map((button) => button.textContent)).toEqual([
      "Subir CV (no disponible)",
      "Reemplazar (no disponible)", "Descargar (no disponible)",
      "Reemplazar (no disponible)", "Descargar (no disponible)", "Usar como principal (no disponible)",
    ]);
  });

  it("keeps every action a native disabled type=button with no handler, link or form", () => {
    const { container } = renderWorkspace();
    for (const button of buttons(container)) {
      expect([button.getAttribute("type"), button.disabled, button.getAttribute("onclick")]).toEqual(["button", true, null]);
    }
    expect(container.querySelectorAll("form")).toHaveLength(0);
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.querySelectorAll("input")).toHaveLength(0);
  });

  it("omits the primary action on the primary card and keeps it on every secondary card", () => {
    const { container } = renderWorkspace();
    expect(card(container, PRIMARY.id).querySelector("[data-pf-cv-make-primary]")).toBeNull();
    expect(card(container, PRIMARY.id).querySelectorAll("[data-pf-cv-replace], [data-pf-cv-download]")).toHaveLength(2);
    expect(card(container, SECONDARY.id).querySelectorAll("[data-pf-cv-make-primary]")).toHaveLength(1);
  });

  it("links every disabled action to the one shared visible unavailable explanation", () => {
    const { container } = renderWorkspace();
    const note = container.querySelector("[data-pf-cv-actions-note]") as HTMLElement;
    expect(note.id).toBe(NOTE_ID);
    expect(note).toHaveTextContent("no se puede subir, reemplazar, descargar ni cambiar el CV principal");
    for (const button of buttons(container)) expect(button).toHaveAttribute("aria-describedby", NOTE_ID);
  });
});

describe("cv workspace empty state", () => {
  it("stays honest with zero cards and a still disabled upload action", () => {
    const { container } = renderWorkspace([]);
    expect(container.querySelectorAll("[data-pf-cv-card]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-pf-cv-list]")).toHaveLength(0);
    expect(container.querySelector("[data-pf-cv-summary]")).toHaveTextContent("Todavía no tienes CVs en esta demo local");
    expect(screen.getByRole("button", { name: "Subir CV (no disponible)" })).toBeDisabled();
    expect(container).not.toHaveTextContent(/Tu CV principal es/u);
  });
});

describe("cv workspace disclosure", () => {
  it("declares the local fictional metadata scope and every unavailable behaviour", () => {
    renderWorkspace();
    const note = screen.getByRole("note");
    expect(note).toHaveAttribute("data-pf-cv-disclosure");
    for (const claim of [
      "metadatos ficticios",
      "no están disponibles para previsualizar ni descargar",
      "no se sube, reemplaza, guarda ni genera nada",
      "el CV principal no puede cambiar",
    ]) expect(note).toHaveTextContent(claim);
  });
});

describe("cv workspace presentation contract", () => {
  it("keeps targets at least 40px, wraps long filenames and stays token-only and responsive", () => {
    const { container } = renderWorkspace();
    for (const button of buttons(container)) expect(button.className).toContain("min-h-10");
    const filename = container.querySelector(`[data-pf-cv-filename="${SECONDARY.id}"]`) as HTMLElement;
    expect(filename.className).toContain("break-all");
    expect(filename.closest(".min-w-0")).not.toBeNull();
    const list = container.querySelector("[data-pf-cv-list]") as HTMLElement;
    expect([list.className.includes("grid-cols-1"), list.className.includes("lg:grid-cols-2")]).toEqual([true, true]);
    const actions = container.querySelector(`[data-pf-cv-card-actions="${SECONDARY.id}"]`) as HTMLElement;
    expect(actions.className).toContain("flex-wrap");
    expect(RAW_COLOR.test(classesOf(container))).toBe(false);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
    expect(SOURCE).not.toMatch(/w-\[\d+px\]/u);
  });

  it("stays a props-only server surface over the portfolio model with no fixture or side effect", () => {
    const modules = [...new Set([...SOURCE.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]))];
    expect(modules).toEqual(["./portfolio-model"]);
    expect(SOURCE).not.toMatch(/["']use client["']/u);
    for (const forbidden of [
      "@/features/", "@/components/", "prototype-", "CANDIDATE_CVS",
      "fetch(", "XMLHttpRequest", "axios", "localStorage", "sessionStorage", "indexedDB",
      "navigator.", "window.", "document.", "useRouter", "next/navigation", "next/link", "next/router",
      "onClick", "onChange", "onSubmit", "onDrag", "draggable", "<form", "<input", "<a ", "href=",
      "downloadUrl", "createObjectURL", "useEffect", "useState", "setTimeout", "setInterval",
      "requestAnimationFrame", "Math.random", "Date.now", "crypto.", "randomUUID", "generated",
    ]) expect(SOURCE, `cv-workspace.tsx must not contain ${forbidden}`).not.toContain(forbidden);
  });
});

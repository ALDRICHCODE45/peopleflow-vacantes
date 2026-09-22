import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CANDIDATE_IDENTITY } from "./prototype-candidate";
import { AccountWorkspace } from "./account-workspace";

// Source as text, so the props-only and side-effect contract stays asserted here.
const SOURCE = readFileSync(join(process.cwd(), "src/features/candidate/account-workspace.tsx"), "utf8");
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|color-mix)\(/u;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu;
const NOTE_ID = "pf-account-actions-note";
const ACTION_LABELS = ["Cambiar correo (no disponible)", "Cambiar contraseña (no disponible)", "Cerrar sesión (no disponible)"] as const;
const buttons = (container: HTMLElement) => Array.from(container.querySelectorAll("button")) as HTMLButtonElement[];
const classesOf = (root: Element) => Array.from(root.querySelectorAll("[class]")).map((node) => node.getAttribute("class") ?? "").join(" ");
const renderWorkspace = (identity = CANDIDATE_IDENTITY) => render(<AccountWorkspace identity={identity} />);
afterEach(cleanup);

describe("account workspace identity facts", () => {
  it("derives the full name, email, Spanish account type and local scope without exposing the user id", () => {
    const { container } = renderWorkspace();
    const identity = container.querySelector("[data-pf-account-identity]") as HTMLElement;
    expect(identity.querySelectorAll("dl")).toHaveLength(1);
    expect(identity).toHaveTextContent(CANDIDATE_IDENTITY.fullName);
    expect(identity).toHaveTextContent(CANDIDATE_IDENTITY.email);
    expect(identity).toHaveTextContent("Candidata");
    expect(identity).toHaveTextContent("Demo local");
    expect(container).not.toHaveTextContent(CANDIDATE_IDENTITY.userId);
    expect(container.textContent ?? "").not.toMatch(UUID);
  });

  it("derives the identity facts from the passed props instead of the frozen fixture", () => {
    const other = { ...CANDIDATE_IDENTITY, userId: "11111111-2222-3333-4444-555555555555", fullName: "Otra Persona Demo", email: "otra.persona@ejemplo.mx" };
    const { container } = renderWorkspace(other);
    const identity = container.querySelector("[data-pf-account-identity]") as HTMLElement;
    expect(identity).toHaveTextContent(other.fullName);
    expect(identity).toHaveTextContent(other.email);
    expect(container).not.toHaveTextContent(CANDIDATE_IDENTITY.fullName);
    expect(container).not.toHaveTextContent(CANDIDATE_IDENTITY.email);
    expect(container).not.toHaveTextContent(other.userId);
  });

  it("keeps the identity facts semantic and free of invented account dates", () => {
    const { container } = renderWorkspace();
    const identity = container.querySelector("[data-pf-account-identity]") as HTMLElement;
    const headingId = identity.getAttribute("aria-labelledby");
    expect(headingId).toBe("pf-account-identity-heading");
    expect(screen.getByRole("heading", { level: 2, name: "Datos de identidad" })).toHaveAttribute("id", headingId);
    expect(Array.from(identity.querySelectorAll("dt")).map((term) => term.textContent)).toEqual([
      "Nombre completo",
      "Correo electrónico",
      "Tipo de cuenta",
      "Alcance",
    ]);
    expect(identity.textContent ?? "").not.toMatch(/fecha|cread|creación|registro|alta|último|inicio de sesión/iu);
  });
});

describe("account workspace access facts", () => {
  it("reports only the truthful unavailable access context", () => {
    const { container } = renderWorkspace();
    const access = container.querySelector("[data-pf-account-access]") as HTMLElement;
    const values = Array.from(access.querySelectorAll("dd")).map((value) => value.textContent);
    expect(access.querySelectorAll("dl")).toHaveLength(1);
    expect(Array.from(access.querySelectorAll("dt")).map((term) => term.textContent)).toEqual([
      "Autenticación y sesión",
      "Proveedor",
      "Verificación de correo",
    ]);
    expect(values).toEqual(["No disponibles en esta demo", "No disponible", "No disponible"]);
  });

  it("never claims a known password, a stored credential or a successful login", () => {
    const { container } = renderWorkspace();
    const access = container.querySelector("[data-pf-account-access]") as HTMLElement;
    expect(access.textContent ?? "").not.toMatch(/tu contraseña|contraseña actual|contraseña guardada|contraseña almacenada|sesión iniciada|sesión activa|acceso concedido|conectada como|token|cookie/iu);
    expect(screen.getByRole("heading", { level: 2, name: "Acceso y seguridad" })).toHaveAttribute("id", "pf-account-access-heading");
  });
});

describe("account workspace disclosure", () => {
  it("declares the fictional local identity and every unavailable behaviour exactly once", () => {
    const { container } = renderWorkspace();
    expect(container.querySelectorAll('[role="note"]')).toHaveLength(1);
    const note = screen.getByRole("note");
    expect(note).toHaveAttribute("data-pf-account-disclosure");
    for (const claim of [
      "identidad ficticia",
      "sesión autenticada real",
      "ni proveedor",
      "ni credenciales",
      "ni estado de verificación",
      "Nada se puede cambiar, guardar ni enviar",
    ]) expect(note).toHaveTextContent(claim);
  });
});

describe("account workspace actions", () => {
  it("renders exactly three disabled native buttons in the exact order", () => {
    const { container } = renderWorkspace();
    const found = buttons(container);
    expect(found.map((button) => button.textContent?.trim())).toEqual([...ACTION_LABELS]);
    for (const label of ACTION_LABELS) expect(screen.getByRole("button", { name: label })).toBeDisabled();
  });

  it("keeps every action a native disabled type=button with no handler, link or form", () => {
    const { container } = renderWorkspace();
    for (const button of buttons(container)) {
      expect([button.getAttribute("type"), button.disabled, button.getAttribute("onclick")]).toEqual(["button", true, null]);
    }
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.querySelectorAll("form, input, select, textarea")).toHaveLength(0);
    expect(container.querySelectorAll('[role="link"], [role="button"]')).toHaveLength(0);
    for (const forbidden of ["href=", "onClick", "onChange", "onSubmit", "<form", "<input", "<a "]) {
      expect(SOURCE, `account-workspace.tsx must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("links every disabled action to the one shared visible explanation", () => {
    const { container } = renderWorkspace();
    const notes = container.querySelectorAll("[data-pf-account-actions-note]");
    expect(notes).toHaveLength(1);
    const note = notes[0] as HTMLElement;
    expect(note.id).toBe(NOTE_ID);
    expect(note).toHaveTextContent(/^Esta demo local no puede cambiar el correo ni la contraseña ni cerrar sesión porque no hay autenticación conectada\.$/u);
    for (const button of buttons(container)) expect(button).toHaveAttribute("aria-describedby", NOTE_ID);
  });
});

describe("account workspace presentation contract", () => {
  it("keeps 40px disabled targets, wraps the email and stays token-only and responsive", () => {
    const { container } = renderWorkspace();
    for (const button of buttons(container)) expect(button.className).toContain("min-h-10");
    const email = container.querySelector("[data-pf-account-email]") as HTMLElement;
    expect(email.className).toContain("break-all");
    expect(email.closest(".min-w-0")).not.toBeNull();
    for (const selector of ["[data-pf-account-identity] dl", "[data-pf-account-access] dl"]) {
      const facts = container.querySelector(selector) as HTMLElement;
      expect([facts.className.includes("grid-cols-1"), facts.className.includes("sm:grid-cols-2")]).toEqual([true, true]);
    }
    expect((container.querySelector("[data-pf-account-actions]") as HTMLElement).className).toContain("flex-wrap");
    expect(RAW_COLOR.test(classesOf(container))).toBe(false);
    expect(classesOf(container)).not.toContain("overflow-x");
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
    expect(SOURCE).not.toMatch(/w-\[\d+px\]/u);
  });

  it("wraps a long normalized email inside a min-w-0 column", () => {
    const longEmail = { ...CANDIDATE_IDENTITY, email: "ximena.barrera.montes.de.oca.candidata.ficticia@correo-ficticio.example.mx" };
    const { container } = renderWorkspace(longEmail);
    const email = container.querySelector("[data-pf-account-email]") as HTMLElement;
    expect(email).toHaveTextContent(longEmail.email);
    expect(email.className).toContain("break-all");
  });

  it("stays a props-only server surface over the candidate model with no fixture or side effect", () => {
    const modules = [...new Set([...SOURCE.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]))];
    expect(modules).toEqual(["./model"]);
    expect(SOURCE).not.toMatch(/["']use client["']/u);
    for (const forbidden of [
      "@/features/", "@/components/", "prototype-", "CANDIDATE_IDENTITY",
      "fetch(", "XMLHttpRequest", "axios", "localStorage", "sessionStorage", "indexedDB",
      "navigator.", "window.", "document.", "useRouter", "next/navigation", "next/link", "next/router",
      "useEffect", "useState", "useRef", "setTimeout", "setInterval", "requestAnimationFrame",
      "Math.random", "Date.now", "crypto.", "randomUUID", "Cognito", "cognito", "Bearer", "cookie", "token",
    ]) expect(SOURCE, `account-workspace.tsx must not contain ${forbidden}`).not.toContain(forbidden);
  });
});

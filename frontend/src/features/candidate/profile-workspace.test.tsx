import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { CandidateProfile } from "./model";
import { CANDIDATE_PROFILE } from "./prototype-candidate";
import { profileToDraft } from "./profile-draft";
import { ProfileWorkspace } from "./profile-workspace";

// Source as text, so the coupling, token and side-effect contracts stay asserted here.
const SOURCE = readFileSync(join(process.cwd(), "src/features/candidate", "profile-workspace.tsx"), "utf8");
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|color-mix)\(/u;
const modulesOf = (source: string) => [...new Set([...source.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]))].sort();
const field = (container: HTMLElement, path: string) => container.querySelector(`[data-pf-profile-field="${path}"]`) as HTMLInputElement;
const dirtyLabel = (container: HTMLElement) => container.querySelector("[data-pf-profile-dirty]")?.textContent;
const announcement = (container: HTMLElement) => container.querySelector("[data-pf-profile-announcement]");
const review = () => screen.getByRole("button", { name: "Revisar datos" });
const reset = () => screen.getByRole("button", { name: "Restaurar copia original" });
const renderWorkspace = (profile: CandidateProfile = CANDIDATE_PROFILE) => render(<ProfileWorkspace profile={profile} />);
afterEach(cleanup);

describe("profile workspace initial state", () => {
  it("seeds the private draft from the profile and discloses the local no-save demo", () => {
    const { container } = renderWorkspace();
    const seeded = profileToDraft(CANDIDATE_PROFILE);
    expect(field(container, "professionalTitle")).toHaveValue(seeded.professionalTitle);
    expect(field(container, "salaryCurrency")).toHaveValue("MXN");
    expect(screen.getByLabelText("Nombre del idioma 1")).toHaveValue("español");
    expect(screen.getByLabelText("Nivel del idioma 2")).toHaveValue("B2");
    const note = screen.getByRole("note");
    expect(note).toHaveAttribute("data-pf-profile-disclosure");
    for (const claim of ["Demo local", "solo en esta vista", "no guarda ni envía", "no cambia tu cuenta", "tu perfil del backend", "tu CV"]) expect(note).toHaveTextContent(claim);
    expect(dirtyLabel(container)).toBe("Sin cambios locales");
    expect(reset()).toBeDisabled();
  });

  it("renders exactly one noValidate form owning the fields, one live region and honest actions", () => {
    const { container } = renderWorkspace();
    const forms = container.querySelectorAll("form");
    expect(forms).toHaveLength(1);
    expect(forms[0]).toHaveAttribute("novalidate");
    expect(forms[0].contains(container.querySelector("[data-pf-profile-fields]"))).toBe(true);
    expect(review()).toHaveAttribute("type", "submit");
    expect(reset()).toHaveAttribute("type", "button");
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(container).not.toHaveTextContent(/\bGuardar\b|\bActualizar\b/u);
  });
});

describe("profile workspace local edits", () => {
  it("keeps edits in local state, marks dirty and never mutates the received profile", async () => {
    const user = userEvent.setup();
    const before = JSON.stringify(CANDIDATE_PROFILE);
    const { container } = renderWorkspace();
    await user.type(screen.getByLabelText("Ciudad de residencia"), "!");
    expect(field(container, "city")).toHaveValue(`${CANDIDATE_PROFILE.city}!`);
    expect(dirtyLabel(container)).toBe("Cambios locales sin guardar");
    expect(reset()).toBeEnabled();
    await user.clear(screen.getByLabelText("Años de experiencia"));
    await user.type(screen.getByLabelText("Años de experiencia"), "11");
    expect(field(container, "yearsOfExperience")).toHaveValue(11);
    expect(JSON.stringify(CANDIDATE_PROFILE)).toBe(before);
  });

  it("clears stale issues and the review announcement on the next edit", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    await user.clear(screen.getByLabelText("Moneda"));
    await user.click(review());
    expect(field(container, "salaryCurrency")).toHaveAttribute("aria-invalid", "true");
    expect(announcement(container)).not.toBeNull();
    await user.type(screen.getByLabelText("Ciudad de residencia"), "a");
    expect(container.querySelectorAll("[aria-invalid]")).toHaveLength(0);
    expect(container.querySelectorAll('[id$="-error"]')).toHaveLength(0);
    expect(announcement(container)).toBeNull();
    expect(dirtyLabel(container)).toBe("Cambios locales sin guardar");
  });
});

describe("profile workspace invalid review", () => {
  it("renders scalar issues, a natural count summary and focuses the first failing control", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    fireEvent.change(screen.getByLabelText("Perfil de LinkedIn"), { target: { value: "no-es-una-url" } });
    fireEvent.change(screen.getByLabelText("Años de experiencia"), { target: { value: "12.5" } });
    await user.clear(screen.getByLabelText("Moneda"));
    await user.click(review());
    expect(field(container, "linkedinUrl")).toHaveAttribute("aria-invalid", "true");
    expect(field(container, "yearsOfExperience")).toHaveAttribute("aria-invalid", "true");
    expect(field(container, "salaryCurrency")).toHaveAttribute("aria-invalid", "true");
    expect(announcement(container)).toHaveTextContent("La revisión local encontró 3 errores.");
    expect(field(container, "linkedinUrl")).toHaveFocus();
    expect(container.querySelector("#profile-linkedinUrl-error")).toHaveTextContent("La URL de LinkedIn no es una URL válida.");
  });

  it("refocuses the same control on every repeated invalid submit", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    await user.clear(screen.getByLabelText("Moneda"));
    await user.click(review());
    expect(field(container, "salaryCurrency")).toHaveFocus();
    screen.getByLabelText("Teléfono").focus();
    expect(field(container, "salaryCurrency")).not.toHaveFocus();
    await user.click(review());
    expect(field(container, "salaryCurrency")).toHaveFocus();
  });

  it("uses the singular count for exactly one issue", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    await user.clear(screen.getByLabelText("Moneda"));
    await user.click(review());
    expect(announcement(container)).toHaveTextContent("La revisión local encontró 1 error.");
    expect(announcement(container)).not.toHaveTextContent("errores");
  });
});

describe("profile workspace language focus", () => {
  it("focuses the indexed level and name controls for language issues", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    await user.selectOptions(screen.getByLabelText("Nivel del idioma 1"), "");
    await user.click(review());
    expect(screen.getByLabelText("Nivel del idioma 1")).toHaveFocus();
    await user.selectOptions(screen.getByLabelText("Nivel del idioma 1"), "C2");
    await user.clear(screen.getByLabelText("Nombre del idioma 2"));
    await user.type(screen.getByLabelText("Nombre del idioma 2"), "español");
    await user.click(review());
    expect(screen.getByLabelText("Nombre del idioma 2")).toHaveFocus();
    expect(container.querySelector("#profile-language-1-name-error")).toHaveTextContent("ya está registrado");
  });

  it("focuses the add control for a root languages issue", async () => {
    const user = userEvent.setup();
    const crowded: CandidateProfile = { ...CANDIDATE_PROFILE, languages: Array.from({ length: 21 }, (_, index) => ({ name: `idioma ${index}`, level: "A1" })) };
    const { container } = renderWorkspace(crowded);
    await user.click(review());
    expect(screen.getByRole("button", { name: "Agregar idioma" })).toHaveFocus();
    expect(announcement(container)).toHaveTextContent("La revisión local encontró 1 error.");
    expect(container.querySelector("#profile-languages-error")).toHaveTextContent("Puedes registrar hasta 20 idiomas.");
  });
});

describe("profile workspace valid review and reset", () => {
  it("reports a passing local review without saving, sending or replacing the profile", async () => {
    const user = userEvent.setup();
    const before = JSON.stringify(CANDIDATE_PROFILE);
    const { container } = renderWorkspace();
    await user.type(screen.getByLabelText("Ciudad de residencia"), "!");
    await user.click(review());
    expect(container.querySelectorAll('[id$="-error"]')).toHaveLength(0);
    expect(announcement(container)).toHaveTextContent("La revisión local pasó");
    expect(announcement(container)).toHaveTextContent("no se guardó ni se envió nada");
    expect(field(container, "city")).toHaveValue(`${CANDIDATE_PROFILE.city}!`);
    expect(dirtyLabel(container)).toBe("Cambios locales sin guardar");
    expect(JSON.stringify(CANDIDATE_PROFILE)).toBe(before);
  });

  it("restores a fresh cloned draft and announces local restoration and no save", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    await user.type(screen.getByLabelText("Ciudad de residencia"), "!");
    await user.click(screen.getByRole("button", { name: "Agregar idioma" }));
    expect(dirtyLabel(container)).toBe("Cambios locales sin guardar");
    await user.click(reset());
    expect(field(container, "city")).toHaveValue(CANDIDATE_PROFILE.city);
    expect(container.querySelectorAll("[data-pf-profile-language-row]")).toHaveLength(2);
    expect(container.querySelectorAll("[data-pf-profile-field='languages'] input")).toHaveLength(2);
    expect(announcement(container)).toHaveTextContent("Restauramos la copia original");
    expect(announcement(container)).toHaveTextContent("No se guardó ni se envió nada");
    expect(dirtyLabel(container)).toBe("Sin cambios locales");
    expect(reset()).toBeDisabled();
  });

  it("still restores after an invalid review left field errors on screen", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    await user.clear(screen.getByLabelText("Moneda"));
    await user.click(review());
    expect(field(container, "salaryCurrency")).toHaveAttribute("aria-invalid", "true");
    await user.click(reset());
    expect(field(container, "salaryCurrency")).toHaveValue("MXN");
    expect(container.querySelectorAll('[id$="-error"]')).toHaveLength(0);
    expect(announcement(container)).toHaveTextContent("No se guardó ni se envió nada");
    expect(reset()).toBeDisabled();
  });
});

describe("profile workspace contract", () => {
  it("keeps 40px targets, visible focus, token-only paint and a responsive footer", () => {
    const { container } = renderWorkspace();
    for (const node of [review(), reset()]) {
      const classes = node.getAttribute("class") ?? "";
      expect(classes.includes("min-h-10") && classes.includes("focus-visible:ring-3"), node.textContent ?? "").toBe(true);
    }
    const footer = container.querySelector("[data-pf-profile-footer]") as HTMLElement;
    expect([footer.className.includes("flex-col"), footer.className.includes("sm:flex-row")]).toEqual([true, true]);
    expect(RAW_COLOR.test(Array.from(container.querySelectorAll("[class]")).map((node) => node.getAttribute("class") ?? "").join(" "))).toBe(false);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
    expect(SOURCE).not.toMatch(/w-\[\d+px\]|overflow-x|w-screen/u);
  });

  it("stays a local client orchestrator over the profile with no fixture, transport or persistence", () => {
    expect(SOURCE).toMatch(/^"use client";/u);
    expect(modulesOf(SOURCE)).toEqual(["./model", "./profile-draft", "./profile-form-fields", "react"]);
    for (const forbidden of ["prototype-candidate", "CANDIDATE_PROFILE", "candidateProfileSchema", "fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB", "navigator.", "document.cookie", "useRouter", "next/navigation", "setTimeout", "setInterval", "Math.random", "Date.now", "window.", "Notification", "alert(", "console.", "onNavigate", "onSave", "crypto."]) {
      expect(SOURCE, `profile-workspace.tsx must not declare ${forbidden}`).not.toContain(forbidden);
    }
  });
});

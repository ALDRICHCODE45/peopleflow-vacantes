import * as React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import { TEAM_MEMBER_ROLE_LABELS, TEAM_MEMBER_ROLES } from "./model";
import { TeamInvitation } from "./team-invitation";

const source = readFileSync(join(process.cwd(), "src/features/employer-team/team-invitation.tsx"), "utf8");
/** Exact copy this affordance must state for an empty or malformed address. */
const EMPTY_ERROR = "Ingresá un correo electrónico para continuar.";
const MALFORMED_ERROR = "Ingresá un correo electrónico válido, por ejemplo nombre@empresa.com.";
/** Every literal paint a token-only surface must never carry in a class list. */
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|color-mix)\(/u;
const classesOf = (root: Element) => Array.from(root.querySelectorAll("[class]")).map((node) => node.getAttribute("class") ?? "").join(" ");
const renderInvitation = () => render(<TeamInvitation />);
const toggle = () => screen.getByRole("button", { name: "Invitar miembro" });
const emailInput = () => screen.getByLabelText("Correo electrónico") as HTMLInputElement;
const roleSelect = () => screen.getByLabelText("Rol") as HTMLSelectElement;
const actionButton = (name: string) => screen.getByRole("button", { name });
const control = (attribute: string) => document.querySelector(`[${attribute}]`) as HTMLElement;
const panel = () => document.querySelector("[data-pf-team-invitation-panel]");
const errorCopy = () => control("data-pf-team-invitation-error")?.textContent;
const statusSurface = () => document.querySelector("[data-pf-team-invitation-status]");
const transientState = () => [emailInput().value, roleSelect().value, errorCopy()];
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TeamInvitation inline toggle", () => {
  it("starts as a closed compact toggle with no disclosure surface and never a modal", async () => {
    const user = userEvent.setup();
    const { container } = renderInvitation();
    expect([toggle().tagName, toggle().getAttribute("aria-expanded"), toggle().getAttribute("aria-controls")]).toEqual(["BUTTON", "false", "team-invitation-panel"]);
    expect(panel()).toBeNull();
    // The affordance states no implementation-status disclosure in any role.
    expect(screen.queryByRole("note")).toBeNull();
    expect(container.querySelector("[data-pf-team-invitation-note]")).toBeNull();
    await user.click(toggle());
    expect([toggle().getAttribute("aria-expanded"), panel()?.getAttribute("id")]).toEqual(["true", "team-invitation-panel"]);
    expect([panel()?.getAttribute("role"), panel()?.hasAttribute("aria-modal"), container.querySelector("[role='dialog']")]).toEqual([null, false, null]);
  });

  it("exposes the exact labels, role options, and default recruiter role", async () => {
    const user = userEvent.setup();
    renderInvitation();
    await user.click(toggle());
    expect(TEAM_MEMBER_ROLES).toEqual(["owner", "recruiter"]);
    expect([emailInput().getAttribute("type"), roleSelect().tagName, roleSelect().value]).toEqual(["email", "SELECT", "recruiter"]);
    expect(Array.from(roleSelect().options).map((option) => [option.value, option.textContent])).toEqual([
      ["owner", TEAM_MEMBER_ROLE_LABELS.owner],
      ["recruiter", TEAM_MEMBER_ROLE_LABELS.recruiter],
    ]);
    expect([actionButton("Enviar invitación").getAttribute("type"), actionButton("Enviar invitación").textContent, actionButton("Cancelar").textContent]).toEqual(["submit", "Enviar invitación", "Cancelar"]);
  });

  it("reopens one clean inline panel after Cancelar and after the main toggle closes it", async () => {
    const user = userEvent.setup();
    renderInvitation();
    await user.click(toggle());
    await user.click(actionButton("Cancelar"));
    expect([panel(), toggle().getAttribute("aria-expanded")]).toEqual([null, "false"]);
    await user.click(toggle());
    expect(transientState()).toEqual(["", "recruiter", undefined]);
    await user.click(toggle());
    expect(panel()).toBeNull();
    await user.click(toggle());
    expect(transientState()).toEqual(["", "recruiter", undefined]);
  });
});

describe("TeamInvitation local validation", () => {
  it("rejects an empty address with a visible alert and keeps the panel fields untouched", async () => {
    const user = userEvent.setup();
    renderInvitation();
    await user.click(toggle());
    await user.click(actionButton("Enviar invitación"));
    expect(control("data-pf-team-invitation-error").getAttribute("role")).toBe("alert");
    expect([errorCopy(), emailInput().value, statusSurface()]).toEqual([EMPTY_ERROR, "", null]);
    expect(panel()).not.toBeNull();
    // A whitespace-only entry arrives empty at validation, so it must read as empty and never as malformed.
    await user.type(emailInput(), "   ");
    await user.click(actionButton("Enviar invitación"));
    expect(transientState()).toEqual(["", "recruiter", EMPTY_ERROR]);
  });

  it("rejects a malformed address, keeps the typed value, and never invents a result", async () => {
    const user = userEvent.setup();
    renderInvitation();
    await user.click(toggle());
    await user.type(emailInput(), "camila.duarte@");
    await user.selectOptions(roleSelect(), "owner");
    await user.click(actionButton("Enviar invitación"));
    // A rejected address resets nothing: neither the typed text nor the chosen role.
    expect(transientState()).toEqual(["camila.duarte@", "owner", MALFORMED_ERROR]);
    expect(statusSurface()).toBeNull();
    await user.type(emailInput(), "nexolabs.mx");
    await user.click(actionButton("Enviar invitación"));
    // A corrected valid submission stays inert and preserves the typed email and chosen role.
    expect([errorCopy(), emailInput().value, roleSelect().value, statusSurface()]).toEqual([undefined, "camila.duarte@nexolabs.mx", "owner", null]);
    expect(panel()).not.toBeNull();
  });
});

describe("TeamInvitation valid submission stays inert", () => {
  it("keeps the typed email, the default role, and the open panel with no status surface", async () => {
    const user = userEvent.setup();
    renderInvitation();
    await user.click(toggle());
    await user.type(emailInput(), "nuevo.miembro@nexolabs.mx");
    await user.click(actionButton("Enviar invitación"));
    expect(transientState()).toEqual(["nuevo.miembro@nexolabs.mx", "recruiter", undefined]);
    expect(panel()).not.toBeNull();
    expect(statusSurface()).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
    expect(source).not.toMatch(/green|emerald|success|CheckIcon/u);
  });

  it("preserves a chosen owner role after a valid submission", async () => {
    const user = userEvent.setup();
    renderInvitation();
    await user.click(toggle());
    await user.selectOptions(roleSelect(), "owner");
    expect(roleSelect().value).toBe("owner");
    await user.click(toggle());
    await user.click(toggle());
    expect(roleSelect().value).toBe("recruiter");
    await user.selectOptions(roleSelect(), "owner");
    await user.type(emailInput(), "tomas.rios@nexolabs.mx");
    await user.click(actionButton("Enviar invitación"));
    expect(transientState()).toEqual(["tomas.rios@nexolabs.mx", "owner", undefined]);
    expect(document.querySelectorAll("[data-pf-team-invitation]")).toHaveLength(1);
  });

  it("clears transient input and error when Cancelar closes the panel", async () => {
    const user = userEvent.setup();
    renderInvitation();
    await user.click(toggle());
    await user.type(emailInput(), "camila.duarte@");
    await user.click(actionButton("Enviar invitación"));
    expect(errorCopy()).toBe(MALFORMED_ERROR);
    await user.click(actionButton("Cancelar"));
    expect(panel()).toBeNull();
    await user.click(toggle());
    expect(transientState()).toEqual(["", "recruiter", undefined]);
  });

  it("clears transient input and error when the main toggle closes the panel", async () => {
    const user = userEvent.setup();
    renderInvitation();
    await user.click(toggle());
    await user.type(emailInput(), "tomas.rios@nexolabs.mx");
    await user.selectOptions(roleSelect(), "owner");
    await user.click(actionButton("Enviar invitación"));
    expect([emailInput().value, roleSelect().value]).toEqual(["tomas.rios@nexolabs.mx", "owner"]);
    await user.click(toggle());
    await user.click(toggle());
    expect(transientState()).toEqual(["", "recruiter", undefined]);
  });
});

describe("TeamInvitation transient-message lifecycle", () => {
  it("resets a stale error on every new attempt, but preserves an email error when only the role changes", async () => {
    const user = userEvent.setup();
    renderInvitation();
    await user.click(toggle());
    // A new email keystroke clears both the stale error and its aria flags.
    await user.type(emailInput(), "camila.duarte@");
    await user.click(actionButton("Enviar invitación"));
    expect([errorCopy(), emailInput().getAttribute("aria-invalid"), emailInput().getAttribute("aria-describedby")]).toEqual([MALFORMED_ERROR, "true", "team-invitation-error"]);
    await user.type(emailInput(), "n");
    expect([errorCopy(), emailInput().getAttribute("aria-invalid"), emailInput().getAttribute("aria-describedby")]).toEqual([undefined, "false", null]);
    // A valid submission is inert: it clears any stale error and keeps the typed email.
    await user.clear(emailInput());
    await user.type(emailInput(), "tomas.rios@nexolabs.mx");
    await user.click(actionButton("Enviar invitación"));
    expect([emailInput().value, errorCopy(), statusSurface()]).toEqual(["tomas.rios@nexolabs.mx", undefined, null]);
    // A role change keeps a still-pending email error in place because the address itself has not changed.
    await user.clear(emailInput());
    await user.type(emailInput(), "camila.duarte@");
    await user.click(actionButton("Enviar invitación"));
    expect(errorCopy()).toBe(MALFORMED_ERROR);
    await user.selectOptions(roleSelect(), "owner");
    expect([emailInput().value, roleSelect().value, errorCopy()]).toEqual(["camila.duarte@", "owner", MALFORMED_ERROR]);
  });
});

describe("TeamInvitation interaction and source contract", () => {
  it("keeps every interactive target at least 40px, focus-visible, token-only, and responsively gridded", async () => {
    const user = userEvent.setup();
    const { container } = renderInvitation();
    expect([toggle().className.includes("h-10"), toggle().className.includes("focus-visible:ring-3")]).toEqual([true, true]);
    await user.click(toggle());
    const interactive = [emailInput(), roleSelect(), actionButton("Enviar invitación"), actionButton("Cancelar")];
    expect(interactive.map((node) => node.className.includes("h-10") && node.className.includes("focus-visible:ring-3"))).toEqual([true, true, true, true]);
    const fields = control("data-pf-team-invitation-fields");
    expect([fields.className.includes("grid-cols-1"), fields.className.includes("sm:grid-cols-2")]).toEqual([true, true]);
    expect(panel()?.className).toContain("rounded-3xl");
    expect(RAW_COLOR.test(classesOf(container))).toBe(false);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
    // The affordance owns no member list, row, or metric surface it could append to.
    expect(container.querySelectorAll("[data-pf-team-row], [data-pf-team-list], [data-pf-team-metric]")).toHaveLength(0);
  });

  it("stays a local-only client affordance with no member collection, callback, transport, or disclosure copy", () => {
    expect(source).toMatch(/^\s*["']use client["']/mu);
    expect(source).toMatch(/export function TeamInvitation\(\)/u);
    expect(source).toContain("Enviar invitación");
    for (const reuse of ["./model", "@/components/ui/button", "@/components/ui/input", "@/components/ui/label"]) {
      expect(source, `team-invitation.tsx must reuse ${reuse}`).toContain(reuse);
    }
    for (const forbidden of ["./prototype-team", "NEXO_TEAM_MEMBERS", "TeamWorkspace", "members", "callback", "props:", "fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB", "navigator.clipboard", "useRouter", "next/navigation", "next/link", ".css", "setTimeout", "setInterval", "Math.random", "randomUUID", "toast", "draggable", "onDrag", "onDrop", '"dialog"', "Probar invitación", "DISCLOSURE", "NO_SEND_STATUS", "data-pf-team-invitation-note", "data-pf-team-invitation-status", 'role="note"', 'role="status"', "no se envió", "no envía correos", "prototipo"]) {
      expect(source, `team-invitation.tsx must not declare ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("never calls fetch or web storage during a full invitation cycle", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const storageSpies = [
      vi.spyOn(window.localStorage, "getItem"), vi.spyOn(window.localStorage, "setItem"),
      vi.spyOn(window.sessionStorage, "getItem"), vi.spyOn(window.sessionStorage, "setItem"),
    ];
    const user = userEvent.setup();
    renderInvitation();
    await user.click(toggle());
    await user.type(emailInput(), "nuevo.miembro@nexolabs.mx");
    await user.click(actionButton("Enviar invitación"));
    await user.click(actionButton("Cancelar"));
    await user.click(toggle());
    await user.click(toggle());
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const spy of storageSpies) expect(spy).not.toHaveBeenCalled();
  });
});

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
/** Exact copy this affordance must state, and the only outcome it may report. */
const NOTE = "Este prototipo no envía correos ni guarda cambios.";
const NO_SEND = "Prototipo: no se envió la invitación ni se guardó ningún cambio.";
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
const statusCopy = () => control("data-pf-team-invitation-status")?.textContent;
const transientState = () => [emailInput().value, roleSelect().value, errorCopy(), statusCopy()];
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TeamInvitation inline toggle", () => {
  it("starts as a closed compact toggle with the persistent disclosure and never a modal", async () => {
    const user = userEvent.setup();
    const { container } = renderInvitation();
    expect([toggle().tagName, toggle().getAttribute("aria-expanded"), toggle().getAttribute("aria-controls")]).toEqual(["BUTTON", "false", "team-invitation-panel"]);
    expect(panel()).toBeNull();
    const note = screen.getByRole("note");
    expect([note.textContent, note.hasAttribute("data-pf-team-invitation-note")]).toEqual([NOTE, true]);
    await user.click(toggle());
    expect([toggle().getAttribute("aria-expanded"), panel()?.getAttribute("id")]).toEqual(["true", "team-invitation-panel"]);
    expect([panel()?.getAttribute("role"), panel()?.hasAttribute("aria-modal"), container.querySelector("[role='dialog']"), screen.getByRole("note").textContent]).toEqual([null, false, null, NOTE]);
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
    expect([actionButton("Probar invitación").textContent, actionButton("Cancelar").textContent]).toEqual(["Probar invitación", "Cancelar"]);
  });

  it("reopens one clean inline panel after Cancelar and after the main toggle closes it", async () => {
    const user = userEvent.setup();
    renderInvitation();
    await user.click(toggle());
    await user.click(actionButton("Cancelar"));
    expect([panel(), toggle().getAttribute("aria-expanded")]).toEqual([null, "false"]);
    await user.click(toggle());
    expect(transientState()).toEqual(["", "recruiter", undefined, undefined]);
    await user.click(toggle());
    expect(panel()).toBeNull();
    await user.click(toggle());
    expect(transientState()).toEqual(["", "recruiter", undefined, undefined]);
  });
});

describe("TeamInvitation local validation", () => {
  it("rejects an empty address with a visible alert and never reports a non-send result", async () => {
    const user = userEvent.setup();
    renderInvitation();
    await user.click(toggle());
    await user.click(actionButton("Probar invitación"));
    expect(control("data-pf-team-invitation-error").getAttribute("role")).toBe("alert");
    expect([errorCopy(), emailInput().value, statusCopy()]).toEqual([EMPTY_ERROR, "", undefined]);
    expect(screen.queryByText(NO_SEND)).toBeNull();
    // A whitespace-only entry arrives empty at validation, so it must read as empty and never as malformed.
    await user.type(emailInput(), "   ");
    await user.click(actionButton("Probar invitación"));
    expect(transientState()).toEqual(["", "recruiter", EMPTY_ERROR, undefined]);
  });

  it("rejects a malformed address, keeps the typed value, and never reports a non-send result", async () => {
    const user = userEvent.setup();
    renderInvitation();
    await user.click(toggle());
    await user.type(emailInput(), "camila.duarte@");
    await user.selectOptions(roleSelect(), "owner");
    await user.click(actionButton("Probar invitación"));
    // A rejected address resets nothing: neither the typed text nor the chosen role.
    expect(transientState()).toEqual(["camila.duarte@", "owner", MALFORMED_ERROR, undefined]);
    expect(screen.queryByText(NO_SEND)).toBeNull();
    await user.type(emailInput(), "nexolabs.mx");
    await user.click(actionButton("Probar invitación"));
    expect([errorCopy(), statusCopy(), emailInput().value]).toEqual([undefined, NO_SEND, ""]);
  });
});

describe("TeamInvitation no-send outcome", () => {
  it("resets fields after a valid recruiter submission and states the explicit no-send/no-save status", async () => {
    const user = userEvent.setup();
    renderInvitation();
    await user.click(toggle());
    await user.type(emailInput(), "nuevo.miembro@nexolabs.mx");
    await user.click(actionButton("Probar invitación"));
    const status = control("data-pf-team-invitation-status");
    expect(transientState()).toEqual(["", "recruiter", undefined, NO_SEND]);
    expect([status.getAttribute("role"), status.getAttribute("aria-live")]).toEqual(["status", "polite"]);
    expect(source).not.toMatch(/green|emerald|success|CheckIcon/u);
  });

  it("resets a chosen owner role back to recruiter after a valid submission", async () => {
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
    await user.click(actionButton("Probar invitación"));
    expect(transientState()).toEqual(["", "recruiter", undefined, NO_SEND]);
    expect(document.querySelectorAll("[data-pf-team-invitation]")).toHaveLength(1);
  });

  it("clears transient input, error, and status when Cancelar closes the panel", async () => {
    const user = userEvent.setup();
    renderInvitation();
    await user.click(toggle());
    await user.type(emailInput(), "camila.duarte@");
    await user.click(actionButton("Probar invitación"));
    expect(errorCopy()).toBe(MALFORMED_ERROR);
    await user.click(actionButton("Cancelar"));
    expect(panel()).toBeNull();
    await user.click(toggle());
    expect(transientState()).toEqual(["", "recruiter", undefined, undefined]);
  });

  it("clears transient input, error, and status when the main toggle closes the panel", async () => {
    const user = userEvent.setup();
    renderInvitation();
    await user.click(toggle());
    await user.type(emailInput(), "tomas.rios@nexolabs.mx");
    await user.selectOptions(roleSelect(), "owner");
    await user.click(actionButton("Probar invitación"));
    expect(statusCopy()).toBe(NO_SEND);
    await user.click(toggle());
    await user.click(toggle());
    expect(transientState()).toEqual(["", "recruiter", undefined, undefined]);
  });
});

describe("TeamInvitation transient-message lifecycle", () => {
  it("resets stale error and no-send status on every new attempt, but preserves an email error when only the role changes", async () => {
    const user = userEvent.setup();
    renderInvitation();
    await user.click(toggle());
    // A new email keystroke clears both the stale error and its aria flags.
    await user.type(emailInput(), "camila.duarte@");
    await user.click(actionButton("Probar invitación"));
    expect([errorCopy(), emailInput().getAttribute("aria-invalid"), emailInput().getAttribute("aria-describedby")]).toEqual([MALFORMED_ERROR, "true", "team-invitation-error"]);
    await user.type(emailInput(), "n");
    expect([errorCopy(), emailInput().getAttribute("aria-invalid"), emailInput().getAttribute("aria-describedby"), statusCopy()]).toEqual([undefined, "false", null, undefined]);
    // A valid submit produces the no-send status; the next email keystroke clears it.
    await user.clear(emailInput());
    await user.type(emailInput(), "tomas.rios@nexolabs.mx");
    await user.click(actionButton("Probar invitación"));
    expect(statusCopy()).toBe(NO_SEND);
    await user.type(emailInput(), "x");
    const nextValue = emailInput().value;
    expect([nextValue.endsWith("x"), statusCopy(), errorCopy()]).toEqual([true, undefined, undefined]);
    // A role change clears the no-send status, but a still-pending email error is preserved.
    await user.clear(emailInput());
    await user.type(emailInput(), "camila.duarte@");
    await user.click(actionButton("Probar invitación"));
    expect(errorCopy()).toBe(MALFORMED_ERROR);
    await user.selectOptions(roleSelect(), "owner");
    expect([emailInput().value, roleSelect().value, errorCopy(), statusCopy()]).toEqual(["camila.duarte@", "owner", MALFORMED_ERROR, undefined]);
  });
});

describe("TeamInvitation interaction and source contract", () => {
  it("keeps every interactive target at least 40px, focus-visible, token-only, and responsively gridded", async () => {
    const user = userEvent.setup();
    const { container } = renderInvitation();
    expect([toggle().className.includes("h-10"), toggle().className.includes("focus-visible:ring-3")]).toEqual([true, true]);
    await user.click(toggle());
    const interactive = [emailInput(), roleSelect(), actionButton("Probar invitación"), actionButton("Cancelar")];
    expect(interactive.map((node) => node.className.includes("h-10") && node.className.includes("focus-visible:ring-3"))).toEqual([true, true, true, true]);
    const fields = control("data-pf-team-invitation-fields");
    expect([fields.className.includes("grid-cols-1"), fields.className.includes("sm:grid-cols-2")]).toEqual([true, true]);
    expect(panel()?.className).toContain("rounded-3xl");
    expect(RAW_COLOR.test(classesOf(container))).toBe(false);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
    // The affordance owns no member list, row, or metric surface it could append to.
    expect(container.querySelectorAll("[data-pf-team-row], [data-pf-team-list], [data-pf-team-metric]")).toHaveLength(0);
  });

  it("stays a local-only client affordance with no member collection, callback, or transport", () => {
    expect(source).toMatch(/^\s*["']use client["']/mu);
    expect(source).toMatch(/export function TeamInvitation\(\)/u);
    for (const reuse of ["./model", "@/components/ui/button", "@/components/ui/input", "@/components/ui/label"]) {
      expect(source, `team-invitation.tsx must reuse ${reuse}`).toContain(reuse);
    }
    for (const forbidden of ["./prototype-team", "NEXO_TEAM_MEMBERS", "TeamWorkspace", "members", "callback", "props:", "fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB", "navigator.clipboard", "useRouter", "next/navigation", "next/link", ".css", "setTimeout", "setInterval", "Math.random", "randomUUID", "toast", "draggable", "onDrag", "onDrop", '"dialog"', "Enviar invitación"]) {
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
    await user.click(actionButton("Probar invitación"));
    await user.click(actionButton("Cancelar"));
    await user.click(toggle());
    await user.click(toggle());
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const spy of storageSpies) expect(spy).not.toHaveBeenCalled();
  });
});

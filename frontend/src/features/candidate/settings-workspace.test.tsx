import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ComponentProps, ReactNode } from "react";

import { applyThemeMode } from "@/components/theme/theme-preferences";
import { SettingsWorkspace } from "./settings-workspace";

// The theme helper is a pass-through spy so notification interactions can be proven
// not to touch the shared theme path while the real read stays in place.
vi.mock("@/components/theme/theme-preferences", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/theme/theme-preferences")>();
  return { ...actual, applyThemeMode: vi.fn(actual.applyThemeMode) };
});

/**
 * Base UI's portaled popup intentionally waits on browser positioning that jsdom
 * cannot complete. This semantic adapter keeps the workspace's real controlled
 * value/onValueChange contract executable; Chromium covers the installed popup.
 */
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  type Option = Readonly<{ value: string; label: string }>;
  type State = Readonly<{ items: readonly Option[]; value: string; onValueChange: (value: string) => void }>;
  type RootProps = Readonly<{ items?: readonly Option[]; value?: string; onValueChange?: (value: string) => void; children?: ReactNode }>;
  const Context = React.createContext<State | null>(null);
  const NullPart = () => null;

  function Select({ items = [], value = "", onValueChange = () => undefined, children }: RootProps) {
    return <Context.Provider value={{ items, value, onValueChange }}>{children}</Context.Provider>;
  }

  function SelectTrigger(props: ComponentProps<"select">) {
    const state = React.useContext(Context);
    if (!state) throw new Error("SelectTrigger requires Select");
    return (
      <select {...props} data-slot="select-trigger" value={state.value} onChange={(event) => state.onValueChange(event.target.value)}>
        {state.items.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
    );
  }

  return { Select, SelectTrigger, SelectValue: NullPart, SelectContent: NullPart, SelectGroup: NullPart, SelectItem: NullPart };
});

const read = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8");
const WORKSPACE = read("src/features/candidate/settings-workspace.tsx");
const SWITCH = read("src/components/ui/switch.tsx");
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|color-mix)\(/u;
/** Strips technical comments so the rendered-copy ban inspects only product strings. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/\/\/[^\n]*/gu, " ");
/** Rendered copy may not expose implementation status; `\b` keeps `localStorage` and data ids intact. */
const IMPLEMENTATION_STATUS_COPY = /\b(?:demo|mock|prototip\w*|fictici\w*|prueba|test|local|no disponible|no implementado|no se guarda|no se env[ií]a|no se sube)\b/iu;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu;
const SECTIONS = [["notificaciones", "Notificaciones"], ["apariencia", "Apariencia"], ["seguridad", "Seguridad"]] as const;
const KEYS = ["matching_vacancies", "application_updates", "recruiter_messages", "weekly_summary"] as const;
const LABELS = ["Alertas de vacantes compatibles", "Cambios en tus postulaciones", "Mensajes de reclutadores", "Resumen semanal"] as const;

const renderWorkspace = () => render(<SettingsWorkspace />);
const classes = (root: Element) => Array.from(root.querySelectorAll("[class]")).map((node) => node.getAttribute("class") ?? "").join(" ");
const slots = (root: Element, name: string) => Array.from(root.querySelectorAll(`[data-slot="${name}"]`));
const notificationSwitch = (container: HTMLElement, key: string) => container.querySelector(`[data-pf-settings-notification="${key}"]`) as HTMLElement;
const notificationSwitches = (container: HTMLElement) => Array.from(container.querySelectorAll("[data-pf-settings-notification]")) as HTMLElement[];
const checkedStates = (nodes: HTMLElement[]) => nodes.map((node) => node.getAttribute("aria-checked"));

/**
 * jsdom has no PointerEvent and no matchMedia/ResizeObserver: the Base UI Switch
 * dispatches its activation click through `window.PointerEvent`, and the Select
 * root reads media queries. The MouseEvent fallback keeps native click activation.
 */
beforeEach(() => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(() => false) })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  vi.mocked(applyThemeMode).mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("settings switch primitive", () => {
  it("ships the official Base UI Switch with native button semantics, official slots and a 40px target", () => {
    for (const part of ['from "@base-ui/react/switch"', "SwitchPrimitive.Thumb", 'data-slot="switch"', 'data-slot="switch-thumb"', "nativeButton", "render={<button />}", "h-10", "focus-visible:ring-3", "focus-visible:ring-ring/30", "disabled:opacity-50", "data-checked:bg-primary", "data-unchecked:bg-input"]) {
      expect(SWITCH).toContain(part);
    }
    // The primitive owns the semantics and callers cannot replace its native root.
    expect(SWITCH).not.toContain("role=");
    expect(SWITCH).not.toContain("aria-checked");
    expect(SWITCH).toContain('Omit<SwitchPrimitive.Root.Props, "nativeButton" | "render">');
    expect(SWITCH.indexOf("{...props}")).toBeLessThan(SWITCH.indexOf('data-slot="switch"'));

    const { container } = renderWorkspace();
    const node = container.querySelector('[data-slot="switch"]') as HTMLElement;
    expect([node.tagName, node.getAttribute("role")]).toEqual(["BUTTON", "switch"]);
    expect(node.getAttribute("class")).toContain("h-10");
    expect(node.querySelector('[data-slot="switch-thumb"]')).not.toBeNull();
  });
});

describe("settings workspace boundaries", () => {
  it("is a client leaf with no props and no personal, storage, timer, network or router surface", () => {
    expect(WORKSPACE.startsWith('"use client";')).toBe(true);
    expect(WORKSPACE).toContain("export function SettingsWorkspace()");
    expect(WORKSPACE).not.toMatch(/SettingsWorkspace\s*\([^)]*\w/u);
    expect(WORKSPACE).not.toMatch(/export type Settings\w*Props/u);
    for (const forbidden of [
      "identity", "Avatar", "avatar", "fullName", "email", "userId", "userType", "CANDIDATE_IDENTITY", "prototype-", "toast",
      "fetch(", "XMLHttpRequest", "axios", "sessionStorage", "indexedDB", "document.cookie", "navigator.", "setItem", "removeItem",
      "Math.random", "Date.now", "setTimeout", "setInterval", "requestAnimationFrame", "crypto.", "randomUUID", "useRouter", "next/navigation", "next/link",
    ]) {
      expect(WORKSPACE, `settings-workspace.tsx must not contain ${forbidden}`).not.toContain(forbidden);
    }
    // The one allowed browser read is the shared theme preference helper.
    expect(WORKSPACE).toContain("readStoredThemeMode(window.localStorage)");

    const { container } = renderWorkspace();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(UUID);
    expect(text).not.toMatch(/fotograf|nombre completo|correo electrónico|tipo de cuenta|@/iu);
  });

  it("exposes exactly three real sections with matching anchors, a nav label and one H2 each", () => {
    const { container } = renderWorkspace();
    const nav = container.querySelector("[data-pf-settings-nav]") as HTMLElement;
    expect(nav.tagName).toBe("NAV");
    expect(nav).toHaveAttribute("aria-label", "Secciones de configuración");
    const links = Array.from(nav.querySelectorAll("a"));
    expect(links.map((link) => [link.getAttribute("href"), link.textContent?.trim()])).toEqual(SECTIONS.map(([id, heading]) => [`#${id}`, heading]));
    for (const link of links) {
      const value = link.getAttribute("class") ?? "";
      expect(value).toContain("min-h-10");
      expect(value).toContain("focus-visible:ring-3");
    }
    for (const [id, heading] of SECTIONS) {
      expect(container.querySelector(`#${id}`)).toHaveAttribute("aria-labelledby", `${id}-heading`);
      expect(screen.getByRole("heading", { level: 2, name: heading })).toHaveAttribute("id", `${id}-heading`);
    }
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(3);
    expect(container.querySelectorAll("h1")).toHaveLength(0);
    // Section descriptions stay in neutral Mexican Spanish, with no voseo.
    expect(screen.getByText("Elige qué avisos quieres tener presentes.")).toBeVisible();
    expect(
      screen.getByText("Elige el tema de la interfaz para este dispositivo."),
    ).toBeVisible();
  });
});

describe("settings notification state", () => {
  it("renders four enabled notification switches plus the enabled inert 2FA switch with the approved defaults", () => {
    const { container } = renderWorkspace();
    expect(screen.getAllByRole("switch")).toHaveLength(5);
    const rows = notificationSwitches(container);
    expect(rows.map((node) => node.getAttribute("data-pf-settings-notification"))).toEqual([...KEYS]);
    expect(checkedStates(rows)).toEqual(["true", "true", "true", "false"]);
    for (const [index, label] of LABELS.entries()) {
      expect(rows[index]).toBeEnabled();
      expect(screen.getByRole("switch", { name: label })).toBe(rows[index]);
    }
    const twoFactor = container.querySelector("[data-pf-settings-2fa]") as HTMLElement;
    expect(twoFactor).toBeEnabled();
    expect(twoFactor).toHaveAttribute("aria-checked", "false");
  });

  it("toggles notifications in component memory without touching the theme path or storage", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const { container } = renderWorkspace();

    fireEvent.click(notificationSwitch(container, "weekly_summary"));
    fireEvent.click(notificationSwitch(container, "recruiter_messages"));
    fireEvent.click(notificationSwitch(container, "weekly_summary"));

    expect(checkedStates([notificationSwitch(container, "weekly_summary"), notificationSwitch(container, "recruiter_messages"), notificationSwitch(container, "matching_vacancies")])).toEqual(["false", "false", "true"]);
    expect(vi.mocked(applyThemeMode)).not.toHaveBeenCalled();
    expect([setItem.mock.calls.length, removeItem.mock.calls.length, window.localStorage.length, document.documentElement.getAttribute("data-theme")]).toEqual([0, 0, 0, null]);
  });

  it("toggles a notification from the keyboard", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    notificationSwitch(container, "weekly_summary").focus();
    await user.keyboard(" ");
    expect(notificationSwitch(container, "weekly_summary")).toHaveAttribute("aria-checked", "true");
    await user.keyboard("{Enter}");
    expect(notificationSwitch(container, "weekly_summary")).toHaveAttribute("aria-checked", "false");
  });
});

describe("settings appearance and security", () => {
  it("labels the theme Select, reads the stored mode after hydration and wires only the theme helpers", async () => {
    window.localStorage.setItem("pf-theme", "dark");
    renderWorkspace();
    const select = screen.getByRole("combobox", { name: "Tema de la interfaz" });
    expect(select).toHaveAttribute("data-pf-settings-theme");
    expect(select.getAttribute("aria-labelledby")).toBe("pf-settings-theme-label");
    expect(select.getAttribute("aria-describedby")).toBe("pf-settings-theme-description");
    expect(WORKSPACE).toContain("<SelectValue />");
    await waitFor(() => expect(select).toHaveValue("dark"));
    for (const helper of ['from "@/components/theme/theme-preferences"', "applyThemeMode(next)", "setThemeMode(next)", "readStoredThemeMode(window.localStorage)", "<SelectItem"]) {
      expect(WORKSPACE).toContain(helper);
    }
  });

  it("applies Claro, Oscuro and Sistema through the existing theme path only", async () => {
    const user = userEvent.setup();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    renderWorkspace();
    const select = screen.getByRole("combobox", { name: "Tema de la interfaz" });

    for (const [, mode] of [["Claro", "light"], ["Oscuro", "dark"], ["Sistema", "system"]] as const) {
      await user.selectOptions(select, mode);
      expect(vi.mocked(applyThemeMode)).toHaveBeenLastCalledWith(mode);
      expect(select).toHaveValue(mode);
    }

    expect(vi.mocked(applyThemeMode).mock.calls.map(([mode]) => mode)).toEqual(["light", "dark", "system"]);
    expect(setItem.mock.calls.map(([key]) => key)).toEqual(["pf-theme", "pf-theme"]);
    expect(removeItem.mock.calls.map(([key]) => key)).toEqual(["pf-theme"]);
    expect(window.localStorage.length).toBe(0);
  });

  it("keeps 2FA and the password action enabled, labelled and inert", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    const twoFactor = container.querySelector("[data-pf-settings-2fa]") as HTMLElement;
    expect(twoFactor).toBeEnabled();
    expect(twoFactor.getAttribute("aria-labelledby")).toBe("pf-settings-2fa-label");
    expect(screen.getByText("Autenticación en dos pasos")).toHaveAttribute("id", "pf-settings-2fa-label");
    // Activation never flips the controlled value: the switch stays inert.
    await user.click(twoFactor);
    expect(twoFactor).toHaveAttribute("aria-checked", "false");
    twoFactor.focus();
    await user.keyboard(" ");
    expect(twoFactor).toHaveAttribute("aria-checked", "false");
    await user.keyboard("{Enter}");
    expect(twoFactor).toHaveAttribute("aria-checked", "false");
    expect(container.querySelector("[data-pf-settings-2fa-status]")).toBeNull();

    const button = screen.getByRole("button", { name: "Cambiar contraseña" });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("type", "button");
    expect(button.getAttribute("class")).toContain("min-h-10");
    expect(button.getAttribute("class")).toContain("border");
    expect(container.querySelector("[data-pf-settings-security-note]")).toBeNull();

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/demo|mock|prototip|prueba|\btest\b|local|disclaimer/iu);
    expect(text).not.toMatch(/activad|habilitad|verificad|guardad|actualizad|correctamente|exitos/iu);
    expect(screen.queryByRole("button", { name: /guardar|activar|habilitar|enviar/iu })).toBeNull();
  });
});

describe("settings composition and presentation", () => {
  it("composes the installed Card, ItemGroup, Item, Select, Button and Switch primitives", () => {
    const { container } = renderWorkspace();
    const counts: Record<string, number> = { card: 3, "card-header": 3, "card-content": 3, "item-group": 3, item: 7, "item-media": 7, "item-content": 7, "item-actions": 7, badge: 0, "select-trigger": 1, button: 1, switch: 5 };
    for (const [name, count] of Object.entries(counts)) expect(slots(container, name)).toHaveLength(count);
    // Rendered copy must stay product-facing: no implementation-status disclosure.
    expect(IMPLEMENTATION_STATUS_COPY.test(stripComments(WORKSPACE))).toBe(false);
    expect(WORKSPACE).not.toContain("data-pf-settings-2fa-status");
    expect(WORKSPACE).not.toContain("data-pf-settings-security-note");
  });

  it("keeps the candidate root geometry with one padding owner and token-only paint", () => {
    const { container } = renderWorkspace();
    const root = container.querySelector("[data-pf-settings-workspace]") as HTMLElement;
    const tokens = root.className.split(/\s+/u);
    expect(["mx-auto", "w-full", "max-w-screen-2xl", "px-4", "py-4", "md:py-6", "lg:px-6"].filter((token) => !tokens.includes(token))).toEqual([]);
    expect(root.className).toContain("lg:grid-cols-");
    const owners = Array.from(container.querySelectorAll("[class]")).filter((node) => {
      const value = (node.getAttribute("class") ?? "").split(/\s+/u);
      return value.includes("px-4") && value.includes("lg:px-6");
    });
    expect(owners).toHaveLength(1);
    expect(owners[0]).toBe(root);

    expect(RAW_COLOR.test(classes(container))).toBe(false);
    expect(WORKSPACE).not.toContain("dark:");
    expect(WORKSPACE).not.toContain("bg-card/40");
    expect(WORKSPACE).not.toMatch(/max-w-(?!screen-2xl)/u);
    expect(WORKSPACE).not.toMatch(/(^|["'\s])h-\d/u);
    expect(WORKSPACE).not.toMatch(/[wh]-\[[^\]]+\]/u);
    expect(WORKSPACE).not.toMatch(/style=\{\{/u);
  });

  it("keeps the visible copy free of disclaimers and capability claims", () => {
    const { container } = renderWorkspace();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/demo|mock|prototip|prueba|\btest\b|local|disclaimer/iu);
    expect(text).not.toMatch(/guardad|guardar|éxito|exitos|correctamente|enviad|sesión iniciada|suscrit|enrol/iu);
  });
});

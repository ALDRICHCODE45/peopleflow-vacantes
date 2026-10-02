import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ComponentProps, ReactNode } from "react";
import { EmployerSettingsWorkspace } from "./settings-workspace";

// As in candidate settings: jsdom cannot position the portaled Base UI popup.
// This adapter tests controlled values; the production view uses installed Select.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  type Option = { value: string; label: string };
  type Value = { items: readonly Option[]; value: string; onValueChange: (value: string) => void };
  const Context = React.createContext<Value | null>(null);
  function Select(props: Value & { children?: ReactNode }) { return <Context.Provider value={props}>{props.children}</Context.Provider>; }
  function SelectTrigger(props: ComponentProps<"select">) {
    const value = React.useContext(Context)!;
    return <select {...props} value={value.value} onChange={event => value.onValueChange(event.target.value)}>{value.items.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>;
  }
  const Empty = () => null;
  return { Select, SelectTrigger, SelectValue: Empty, SelectContent: Empty, SelectGroup: Empty, SelectItem: Empty };
});

beforeEach(() => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("data-theme");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

const sections = ["Organización", "Reclutamiento", "Notificaciones", "Apariencia", "Seguridad"];

describe("employer settings", () => {
  it("provides five real sections in the same responsive card-and-rail pattern as candidate settings", () => {
    const { container } = render(<EmployerSettingsWorkspace />);
    expect(container.querySelectorAll("[data-slot='card']")).toHaveLength(5);
    expect(screen.getAllByRole("heading", { level: 2 }).map(heading => heading.textContent)).toEqual(sections);
    const navigation = screen.getByRole("navigation", { name: "Secciones de configuración de empresa" });
    expect(within(navigation).getAllByRole("link")).toHaveLength(5);
    for (const link of within(navigation).getAllByRole("link")) {
      const target = document.querySelector(link.getAttribute("href")!);
      expect(target).toHaveAccessibleName(link.textContent!);
    }
    expect(container.querySelector("[data-pf-employer-settings-workspace]")).toHaveClass("lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]");
  });

  it("links organization actions to existing team and careers-site pages", () => {
    render(<EmployerSettingsWorkspace />);
    expect(screen.getByRole("link", { name: "Administrar equipo" })).toHaveAttribute("href", "/empresa/equipo");
    expect(screen.getByRole("link", { name: "Editar sitio" })).toHaveAttribute("href", "/empresa/sitio");
    expect(document.querySelector("a[href='#']")).toBeNull();
    expect(screen.queryByText("Plan y facturación")).toBeNull();
  });

  it("changes recruitment and notification preferences only for the current visit", () => {
    const persist = vi.spyOn(Storage.prototype, "setItem");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { unmount } = render(<EmployerSettingsWorkspace />);
    const cv = screen.getByRole("switch", { name: "Permitir postulaciones sin CV" });
    const alerts = screen.getByRole("switch", { name: "Nuevas postulaciones" });
    expect(cv).toBeChecked();
    expect(alerts).toBeChecked();
    fireEvent.click(cv);
    fireEvent.click(alerts);
    expect(cv).not.toBeChecked();
    expect(alerts).not.toBeChecked();
    expect(persist).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    unmount();
    render(<EmployerSettingsWorkspace />);
    expect(screen.getByRole("switch", { name: "Permitir postulaciones sin CV" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Nuevas postulaciones" })).toBeChecked();
  });

  it("uses the shared persistent theme preference without adding a company theme", () => {
    localStorage.setItem("pf-theme", "dark");
    render(<EmployerSettingsWorkspace />);
    const theme = screen.getByRole("combobox", { name: "Tema de la interfaz" });
    expect(theme).toHaveValue("dark");
    fireEvent.change(theme, { target: { value: "light" } });
    expect(localStorage.getItem("pf-theme")).toBe("light");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("keeps security presentation controls enabled and inert without success claims", () => {
    const persist = vi.spyOn(Storage.prototype, "setItem");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<EmployerSettingsWorkspace />);
    const security = screen.getByRole("switch", { name: "Autenticación en dos pasos" });
    const password = screen.getByRole("button", { name: "Cambiar contraseña" });
    expect(security).toBeEnabled();
    expect(password).toBeEnabled();
    fireEvent.click(security);
    fireEvent.click(password);
    expect(security).not.toBeChecked();
    expect(persist).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

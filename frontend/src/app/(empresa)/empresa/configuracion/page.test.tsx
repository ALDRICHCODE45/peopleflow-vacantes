import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import Page, { metadata } from "./page";

vi.mock("@/components/company-dashboard/site-header", () => ({ SiteHeader: ({ title }: { title: string }) => <header><h1>{title}</h1></header> }));
vi.mock("@/features/employer-settings/settings-workspace", () => ({ EmployerSettingsWorkspace: () => <section aria-label="Configuración de empresa" /> }));

describe("company settings route", () => {
  it("composes its settings workspace and heading without duplicating the shared shell", () => {
    const { container } = render(<Page />);
    expect(metadata.title).toBe("Configuración");
    expect(screen.getByRole("heading", { level: 1, name: "Configuración" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Configuración de empresa" })).toBeInTheDocument();
    expect(container.querySelector("[data-slot='sidebar-wrapper']")).toBeNull();
  });
});

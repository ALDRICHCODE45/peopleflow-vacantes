import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { stakeholderRoute } from "@/features/identity/stakeholder-routes";
import Page, { metadata } from "./page";

vi.mock("@/components/company-dashboard/site-header", () => ({
  SiteHeader: ({ title, parent }: { title: string; parent?: { label: string; href: string } }) =>
    <header>{parent && <a href={parent.href}>{parent.label}</a>}<h1>{title}</h1></header>,
}));
vi.mock("@/features/notifications/ui/notification-preferences", () => ({
  NotificationPreferences: ({ scope }: { scope: string }) => <section aria-label="Preferencias de notificaciones" data-scope={scope} />,
}));

describe("company notification preferences route (T4.2)", () => {
  it("renders the header with the Configuración crumb and the company-scoped preferences", () => {
    render(<Page />);
    expect(metadata.title).toBe("Notificaciones");
    expect(screen.getByRole("heading", { level: 1, name: "Notificaciones" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Configuración" })).toHaveAttribute("href", "/empresa/configuracion");
    expect(screen.getByRole("region", { name: "Preferencias de notificaciones" })).toHaveAttribute("data-scope", "company");
  });

  it("is closed to stakeholders by the employer route gate before the page mounts (contract Q7)", () => {
    expect(stakeholderRoute("/empresa/configuracion/notificaciones")).toBe("blocked");
  });
});

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import Page, { metadata } from "./page";

vi.mock("@/components/candidate-dashboard/candidate-header", () => ({
  CandidateHeader: ({ title, parent }: { title: string; parent?: { label: string; href: string } }) =>
    <header>{parent && <a href={parent.href}>{parent.label}</a>}<h1>{title}</h1></header>,
}));
vi.mock("@/features/notifications/ui/notification-preferences", () => ({
  NotificationPreferences: ({ scope }: { scope: string }) => <section aria-label="Preferencias de notificaciones" data-scope={scope} />,
}));

describe("candidate notification preferences route (T4.2)", () => {
  it("renders the header with the Configuración crumb and the candidate-scoped preferences", () => {
    render(<Page />);
    expect(metadata.title).toBe("Notificaciones");
    expect(screen.getByRole("heading", { level: 1, name: "Notificaciones" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Configuración" })).toHaveAttribute("href", "/candidato/configuracion");
    expect(screen.getByRole("region", { name: "Preferencias de notificaciones" })).toHaveAttribute("data-scope", "candidate");
  });
});

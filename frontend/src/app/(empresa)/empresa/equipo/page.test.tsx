import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
vi.mock("@/components/company-dashboard/site-header", () => ({ SiteHeader: ({ title }: { title: string }) => <header><h1>{title}</h1></header> }));
vi.mock("@/features/employer-team/team-page", () => ({ TeamPage: () => <div data-testid="live-team">Equipo conectado</div> }));
import Page, { metadata } from "./page";
afterEach(cleanup);
it("keeps the header, metadata and shared DashboardPageContent frame", () => {
  const { container } = render(<Page />);
  expect(metadata.title).toBe("Equipo");
  expect(screen.getByRole("heading", { name: "Equipo" })).toBeInTheDocument();
  const frame = container.querySelector('[data-pf-page-content]');
  expect(frame).toHaveClass("max-w-screen-2xl", "px-4", "lg:px-6");
  expect(frame).toContainElement(screen.getByTestId("live-team"));
});
it("never mounts invitation or prototype data", () => {
  render(<Page />);
  expect(screen.queryByRole("button", { name: "Invitar miembro" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Tomás Ríos|Valeria Ortiz/)).not.toBeInTheDocument();
});
it("remains server composition, with no prototype imports or extra shell", () => {
  const source = readFileSync("src/app/(empresa)/empresa/equipo/page.tsx", "utf8");
  expect(source).not.toMatch(/prototype-team|TeamInvitation|NEXO_TEAM_MEMBERS|"use client"|<EmployerShell/);
  expect(source).toContain("<TeamPage />");
});

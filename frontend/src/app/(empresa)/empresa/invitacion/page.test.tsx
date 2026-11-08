import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
vi.mock("@/components/company-dashboard/site-header", () => ({ SiteHeader: ({ title }: { title: string }) => <header><h1>{title}</h1></header> }));
vi.mock("@/features/stakeholder-invitations/accept-page", () => ({
  AcceptInvitationPage: ({ token }: { token: string }) => <p>accept:{token}</p>,
  AcceptOutcomePage: ({ outcome }: { outcome: string | null }) => <p>outcome:{String(outcome)}</p>,
}));
import OutcomePage, { metadata as outcomeMetadata } from "./page";
import TokenPage, { metadata as tokenMetadata } from "./[token]/page";
afterEach(cleanup);
const token = "q3Jv8tR0wXbN5eLk2sYp9uHf7aCd1gMz4iOq6TnVrWo";

it("mounts the server-side accept with the route token, never indexed", async () => {
  render(await TokenPage({ params: Promise.resolve({ token }) }));
  expect(screen.getByRole("heading", { name: "Invitación" })).toBeInTheDocument();
  expect(screen.getByText(`accept:${token}`)).toBeInTheDocument();
  expect(tokenMetadata).toMatchObject({ title: "Invitación", robots: { index: false, follow: false }, referrer: "no-referrer" });
});

it.each([["unido", "unido"], ["ya-miembro", "ya-miembro"], ["otra-cosa", "null"], [undefined, "null"]])("passes only a known outcome (%s) to the token-free page", async (estado, shown) => {
  render(await OutcomePage({ searchParams: Promise.resolve(estado === undefined ? {} : { estado }) }));
  expect(screen.getByText(`outcome:${shown}`)).toBeInTheDocument();
  expect(outcomeMetadata).toMatchObject({ robots: { index: false, follow: false }, referrer: "no-referrer" });
});

import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const workspace = vi.hoisted(() => vi.fn());
vi.mock("@/features/candidate/profile-workspace", () => ({ ProfileWorkspace: (props: unknown) => { workspace(props); return <section aria-label="Perfil real" />; } }));
vi.mock("@/components/candidate-dashboard/candidate-header", () => ({ CandidateHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
import Page, { metadata } from "./page";
afterEach(cleanup);
it("keeps Perfil metadata and one heading before the live workspace", () => {
  render(<Page />);
  expect(metadata.title).toBe("Perfil");
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByRole("heading")).toHaveTextContent("Perfil");
  expect(screen.getByRole("heading").compareDocumentPosition(screen.getByRole("region", { name: "Perfil real" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
it("does not inject prototype identity, location or portrait into the live editor", () => {
  render(<Page />);
  expect(workspace.mock.calls.at(-1)?.[0]).toEqual({});
  const source = readFileSync(join(process.cwd(), "src/app/(candidato)/candidato/perfil/page.tsx"), "utf8");
  expect(source).not.toMatch(/prototype-candidate|CANDIDATE_PROFILE|CANDIDATE_IDENTITY|avatarSrc|city|country/);
  expect(source).not.toMatch(/use client|fetch\(|localStorage|useState|useEffect|CandidateShell|<form/);
});

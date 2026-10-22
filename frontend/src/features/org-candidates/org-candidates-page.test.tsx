import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

// The list and the sheet own their own transport and tests; here only the wiring between them is checked.
vi.mock("./list/list-workspace", () => ({
  OrgCandidatesWorkspace: ({ onOpenCandidate, updatedCandidate }: { onOpenCandidate?: (c: { kind: "manual" | "organic"; id: string }) => void; updatedCandidate?: { full_name: string } | null }) =>
    <><button type="button" onClick={() => onOpenCandidate?.({ kind: "organic", id: "3f0c0000-0000-4000-8000-000000000001" })}>Abrir candidato</button><span>{updatedCandidate?.full_name ?? "Nombre anterior"}</span></>,
}));
vi.mock("./detail/detail-sheet", () => ({
  OrgCandidateDetailSheet: ({ candidate, onOpenChange, onCandidateUpdated }: { candidate: { kind: string; id: string } | null; onOpenChange: (open: boolean) => void; onCandidateUpdated?: (detail: ReturnType<typeof detailFixture>) => void }) =>
    candidate ? <div role="dialog" aria-label="Ficha"><span>{`${candidate.kind}:${candidate.id}`}</span><button type="button" onClick={() => onOpenChange(false)}>Cerrar</button><button onClick={() => onCandidateUpdated?.({ ...detailFixture("organic"), id: candidate.id, full_name: "Nombre actualizado" })}>Guardar</button></div> : null,
}));
import { OrgCandidatesPage } from "./org-candidates-page";
import { detailFixture } from "./detail/test-fixtures";

afterEach(cleanup);

it("refreshes the list row after the sheet saves and keeps the selection", async () => {
  const user = userEvent.setup(); render(<OrgCandidatesPage />);
  await user.click(screen.getByRole("button", { name: "Abrir candidato" }));
  await user.click(screen.getByRole("button", { name: "Guardar" }));
  expect(screen.getByText("Nombre actualizado")).toBeVisible();
  expect(screen.getByRole("dialog", { name: "Ficha" })).toBeVisible();
});

it("opens the selected candidate's sheet from the list and clears it on close", async () => {
  const user = userEvent.setup();
  render(<OrgCandidatesPage />);
  expect(screen.queryByRole("dialog")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Abrir candidato" }));
  expect(screen.getByRole("dialog", { name: "Ficha" })).toHaveTextContent("organic:3f0c0000-0000-4000-8000-000000000001");
  await user.click(screen.getByRole("button", { name: "Cerrar" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

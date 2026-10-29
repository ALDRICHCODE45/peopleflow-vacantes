import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { BoardColumns } from "./board-columns";
import { boardFixture, vacancyId } from "./board-fixture";
import { InvitationsProvider } from "@/features/psychometrics/sheet/state";
import { loadInvitationsAction } from "@/features/psychometrics/actions";
import { invitation } from "@/features/psychometrics/fixtures.test";
import { invitationSchema } from "@/features/psychometrics/model";
vi.mock("@/features/psychometrics/actions", () => ({ loadInvitationsAction: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it.each([
  ["created", "Enviada · vence 4 nov"], ["in_progress", "En curso · 17 de 63"], ["finished", "Finalizado"], ["expired", "Vencida"], ["revoked", "Revocada"],
] as const)("renders %s from the board-scoped server status without cluttering other cards", async (status, label) => {
  const board = boardFixture();
  board.participations.push({ ...board.participations[0], id: "other", candidate: { ...board.participations[0].candidate, full_name: "Otra persona" } });
  vi.mocked(loadInvitationsAction).mockResolvedValue({ ok: true, data: { items: [{ ...invitationSchema.parse(invitation), status, participation_id: board.participations[0].id, answered_count: 17, expires_at: "2026-11-04T15:00:00Z" }] } });
  render(<InvitationsProvider vacancyId={vacancyId}><BoardColumns board={board} pending={new Set()} locked={false} notices={{}} onMove={() => {}} onDetail={() => {}} onDisposition={() => {}} /></InvitationsProvider>);
  await screen.findByText(label);
  const card = document.getElementById(`candidate-card-${board.participations[0].id}`)! as HTMLElement;
  expect(within(card).getByText("Psicometría")).toBeVisible();
  if (status === "in_progress") expect(within(card).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "17");
  else expect(within(card).queryByRole("progressbar")).not.toBeInTheDocument();
  expect(loadInvitationsAction).toHaveBeenCalledTimes(1);
  const other = document.getElementById(`candidate-card-${board.participations[1].id}`)! as HTMLElement;
  expect(within(other).queryByText("Psicometría")).not.toBeInTheDocument();
  expect(card.querySelector('[data-variant="review"]')).toBeNull();
});
it("refreshes automatic invitations after a confirmed movement without changing the move response", async () => {
  const board = boardFixture();
  vi.mocked(loadInvitationsAction).mockResolvedValueOnce({ ok: true, data: { items: [] } });
  vi.mocked(loadInvitationsAction).mockResolvedValue({ ok: true, data: { items: [{ ...invitationSchema.parse(invitation), participation_id: board.participations[0].id, origin: "auto", created_by: null }] } });
  const view = (movementKey: string) => <InvitationsProvider vacancyId={vacancyId} movementKey={movementKey}><BoardColumns board={board} pending={new Set()} locked={false} notices={{}} onMove={() => {}} onDetail={() => {}} onDisposition={() => {}} /></InvitationsProvider>;
  const rendered = render(view("before"));
  await screen.findByRole("button", { name: "Ver detalle de Ana Pérez" });
  expect(screen.queryByText("Psicometría")).not.toBeInTheDocument();
  rendered.rerender(view("confirmed-after"));
  expect(await screen.findByText("Psicometría")).toBeVisible();
  expect(loadInvitationsAction).toHaveBeenCalledTimes(2);
});

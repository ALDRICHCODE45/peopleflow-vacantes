import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../actions", () => ({
  getUnreadCountAction: vi.fn(), listNotificationsAction: vi.fn(), markReadAction: vi.fn(), markUnreadAction: vi.fn(),
  markAllReadAction: vi.fn(), getFacetsAction: vi.fn(),
  getCandidateUnreadCountAction: vi.fn(), listCandidateNotificationsAction: vi.fn(), markCandidateReadAction: vi.fn(),
  markCandidateUnreadAction: vi.fn(), markAllCandidateReadAction: vi.fn(), getCandidateFacetsAction: vi.fn(),
}));
vi.mock("next/link", async () => {
  const { forwardRef, createElement } = await import("react");
  type Props = { href: string; onClick?: (event: { preventDefault(): void }) => void };
  return { default: forwardRef<HTMLAnchorElement, Props>(({ href, onClick, ...props }, ref) =>
    createElement("a", { ...props, ref, href, onClick: (event: { preventDefault(): void }) => { onClick?.(event); event.preventDefault(); } })) };
});
import * as actions from "../actions";
import { anaParticipation, candidateGroup, candidatePage, invitationId, markResult } from "../test-fixtures";
import { stubBrowserApis } from "./inbox-harness";
import { NotificationBell } from "./notification-bell";

const m = vi.mocked(actions);
const companyActions = [m.getUnreadCountAction, m.listNotificationsAction, m.markReadAction, m.markUnreadAction, m.markAllReadAction, m.getFacetsAction];

beforeEach(() => {
  vi.resetAllMocks();
  stubBrowserApis();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-26T20:00:00Z"));
  m.getCandidateUnreadCountAction.mockResolvedValue({ ok: true, data: { unread_count: 2, unread_notifications: 2 } });
  m.listCandidateNotificationsAction.mockResolvedValue({ ok: true, data: candidatePage() });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function openCandidateInbox() {
  const user = userEvent.setup();
  render(<NotificationBell scope="candidate" />);
  await user.click(await screen.findByRole("button", { name: "Notificaciones, 2 sin leer" }));
  const dialog = await screen.findByRole("dialog", { name: "Notificaciones" });
  return { user, dialog };
}

it("polls and lists through the candidate actions only", async () => {
  const { dialog } = await openCandidateInbox();
  await within(dialog).findByRole("heading", { name: "Hoy" });
  expect(m.listCandidateNotificationsAction).toHaveBeenCalledWith({ state: "unread" });
  for (const action of companyActions) expect(action).not.toHaveBeenCalled();
});

it("shows company, vacancy and destination per row, with candidate links", async () => {
  const { dialog } = await openCandidateInbox();
  const message = await within(dialog).findByRole("link", { name: /Grupo Altavista te dejó un mensaje sobre Analista de nómina/ });
  expect(message).toHaveAttribute("href", `/candidato/postulaciones?postulacion=${anaParticipation}`);
  expect(message).toHaveTextContent("Abre tu postulación para leerlo.");
  expect(message).toHaveTextContent("Postulación");
  const status = within(dialog).getByRole("link", { name: /Tu postulación a Analista de nómina pasó a En proceso/ });
  expect(status).toHaveTextContent("Grupo Altavista");
  const test = within(dialog).getByRole("link", { name: /Tienes una prueba psicométrica pendiente/ });
  expect(test).toHaveAttribute("href", `/candidato/evaluaciones/${invitationId}`);
  expect(test).toHaveTextContent("Analista de nómina · Grupo Altavista");
  expect(test).toHaveTextContent("Evaluación");
});

it("has no attention section, no sample sublist and no «Filtrar» (design 04)", async () => {
  // Even if a page carried them, the candidate inbox would not show them.
  m.listCandidateNotificationsAction.mockResolvedValue({ ok: true, data: candidatePage({
    attention: [candidateGroup({ group_key: "n:attn", urgency: "overdue" })], attention_total: 1,
    items: [candidateGroup({ count: 3, sample: [{ participation_id: anaParticipation, name: "Ana" }, { participation_id: invitationId, name: "Eva" }] })],
  }) });
  const { dialog } = await openCandidateInbox();
  await within(dialog).findByRole("heading", { name: "Hoy" });
  expect(within(dialog).queryByRole("region", { name: /Requiere atención/ })).toBeNull();
  expect(within(dialog).queryByRole("button", { name: /^Ver los/ })).toBeNull();
  expect(within(dialog).queryByRole("button", { name: /Filtrar/ })).toBeNull();
  expect(within(dialog).getByText("2 sin leer")).toBeInTheDocument();
  expect(within(dialog).queryByText(/atención/)).toBeNull();
});

it("a row without a link is not clickable", async () => {
  m.listCandidateNotificationsAction.mockResolvedValue({ ok: true, data: candidatePage({ items: [candidateGroup({ link: null, company: null })] }) });
  const { dialog } = await openCandidateInbox();
  await within(dialog).findByText("Tu postulación a Analista de nómina pasó a En proceso", { exact: false });
  expect(within(dialog).queryByRole("link", { name: /Tu postulación/ })).toBeNull();
});

it("marks one read, all read and undoes through the candidate writes", async () => {
  m.markCandidateReadAction.mockResolvedValue({ ok: true, data: markResult({ unread_count: 1 }) });
  m.markAllCandidateReadAction.mockResolvedValue({ ok: true, data: markResult({ affected_notifications: 1, unread_count: 0 }) });
  m.markCandidateUnreadAction.mockResolvedValue({ ok: true, data: markResult({ unread_count: 1 }) });
  const { user, dialog } = await openCandidateInbox();
  const row = (await within(dialog).findByRole("link", { name: /pasó a En proceso/ })).closest("li")!;
  await user.click(within(row).getByRole("button", { name: "Marcar como leída" }));
  expect(m.markCandidateReadAction).toHaveBeenCalledWith({ groupKeys: [candidateGroup().group_key] });
  await user.click(await within(dialog).findByRole("button", { name: /Marcar todo como leído/ }));
  expect(m.markAllCandidateReadAction).toHaveBeenCalledWith({ before: "2026-11-26T18:40:00Z" });
  await user.click(await within(dialog).findByRole("button", { name: "Deshacer" }));
  expect(m.markCandidateUnreadAction).toHaveBeenCalledWith({ markedAt: markResult().marked_at });
  for (const action of companyActions) expect(action).not.toHaveBeenCalled();
});

it("first use speaks to the candidate (design 04)", async () => {
  m.listCandidateNotificationsAction.mockResolvedValue({ ok: true, data: candidatePage({ items: [], unread_count: 0, unread_notifications: 0 }) });
  const { user, dialog } = await openCandidateInbox();
  await user.click(await within(dialog).findByRole("tab", { name: "Todas" }));
  expect(await within(dialog).findByText("Aquí te avisaremos cuando una empresa cambie el estado de tu postulación, te escriba o te pida una prueba.")).toBeInTheDocument();
});

it("an account without candidate access (403 account_required) gets an empty inbox and no polling", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  const refused = { ok: false as const, reason: "forbidden" as const, reference: { status: 403, code: "account_required" } };
  m.getCandidateUnreadCountAction.mockResolvedValue(refused);
  m.listCandidateNotificationsAction.mockResolvedValue(refused);
  render(<NotificationBell scope="candidate" />);
  await waitFor(() => expect(m.getCandidateUnreadCountAction).toHaveBeenCalledTimes(1));
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(m.getCandidateUnreadCountAction).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Notificaciones" })).toBeInTheDocument();
});

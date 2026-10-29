import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { InvitationsProvider, useInvitations } from "./state";
import { loadInvitationsAction } from "../actions";
vi.mock("../actions", () => ({ loadInvitationsAction: vi.fn() }));
afterEach(cleanup);
function Probe() {
  const context = useInvitations();
  return <p>{context?.reading ? "Leyendo" : context?.failed ? "Sin estado" : "Estado disponible"}</p>;
}
it("refreshes status only after confirmed board movement; does not refetch on first board arrival", async () => {
  vi.mocked(loadInvitationsAction).mockResolvedValue({ ok: true, data: { items: [] } });
  function Harness() {
    const [key, setKey] = useState<string>();
    return <><button onClick={() => setKey("first")}>Llega tablero</button><button onClick={() => setKey("moved")}>Movimiento confirmado</button><InvitationsProvider vacancyId="vacancy" movementKey={key}><Probe /></InvitationsProvider></>;
  }
  render(<Harness />);
  await screen.findByText("Estado disponible");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Llega tablero" })));
  expect(loadInvitationsAction).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Movimiento confirmado" }));
  await waitFor(() => expect(loadInvitationsAction).toHaveBeenCalledTimes(2));
});

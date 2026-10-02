import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import { CANDIDATE_APPLICATION_MESSAGES } from "./prototype-messages";
import { ApplicationMessage } from "./application-message";

const message = CANDIDATE_APPLICATION_MESSAGES[0];

/**
 * jsdom has neither PointerEvent nor media/observer APIs: Base UI's Button
 * dispatches its activation click through `window.PointerEvent`, and the Dialog
 * root reads media queries.
 */
beforeEach(() => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => false,
  })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const island = () => document.querySelector(`[data-pf-application-message="${message.applicationId}"]`) as HTMLElement;
const openButton = () => within(island()).getByRole("button", { name: "Ver mensaje" });

describe("ApplicationMessage", () => {
  it("shows the unread notice and opens the real letter on Ver mensaje", async () => {
    const user = userEvent.setup();
    render(<ApplicationMessage message={message} />);
    expect(within(island()).getByText("Nuevo mensaje")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(openButton());

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: message.subject })).toBeInTheDocument();
    expect(dialog).toHaveTextContent(message.sender);
    expect(within(dialog).getByText("1 de marzo de 2026")).toBeInTheDocument();
    for (const paragraph of message.body) expect(within(dialog).getByText(paragraph)).toBeInTheDocument();
  });

  it("clears the notice for the rest of the mount and keeps Ver mensaje to reread", async () => {
    const user = userEvent.setup();
    render(<ApplicationMessage message={message} />);

    await user.click(openButton());
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(within(island()).queryByText("Nuevo mensaje")).toBeNull();
    expect(openButton()).toBeInTheDocument();

    await user.click(openButton());
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(within(island()).queryByText("Nuevo mensaje")).toBeNull();
  });
});

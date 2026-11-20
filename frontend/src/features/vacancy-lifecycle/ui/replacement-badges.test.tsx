import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ReplacementBadges, ReplacementLinkBar } from "./replacement-badges";
import type { Lifecycle } from "../model";

const original = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const replacement = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f";
const base: Lifecycle = { close_reason: "filled", close_reason_note: null, publication: "closed", process: "finished", version: "5", published_at: null, paused_at: null, closed_at: null, process_finished_at: null, allowed_actions: [] };
afterEach(cleanup);

it("renders nothing for an old backend payload", () => {
  const { container } = render(<><ReplacementBadges lifecycle={base} /><ReplacementLinkBar lifecycle={base} selfId={original} /></>);
  expect(container).toBeEmptyDOMElement();
});
it("renders nothing for a plain original", () => {
  const { container } = render(<><ReplacementBadges lifecycle={{ ...base, kind: "original", replacement_of: null, active_replacement_id: null }} /><ReplacementLinkBar lifecycle={{ ...base, kind: "original", active_replacement_id: null }} selfId={original} /></>);
  expect(container).toBeEmptyDOMElement();
});
it("badges a private replacement «Reemplazo» + «Privada»", () => {
  render(<ReplacementBadges lifecycle={{ ...base, kind: "replacement", visibility: "private", replacement_of: original }} />);
  expect(screen.getByText("Reemplazo")).toHaveAttribute("data-slot", "badge");
  expect(screen.getByText("Privada")).toHaveAttribute("data-slot", "badge");
});
it("a public replacement has no «Privada» badge", () => {
  render(<ReplacementBadges lifecycle={{ ...base, kind: "replacement", visibility: "public", replacement_of: original }} />);
  expect(screen.getByText("Reemplazo")).toBeVisible();
  expect(screen.queryByText("Privada")).not.toBeInTheDocument();
});
it("a replacement links back to its original", () => {
  render(<ReplacementLinkBar lifecycle={{ ...base, kind: "replacement", replacement_of: original, active_replacement_id: replacement }} selfId={replacement} />);
  expect(screen.getByRole("link", { name: /Ver original/ })).toHaveAttribute("href", `/empresa/vacantes/${original}/pipeline`);
  expect(screen.queryByRole("link", { name: /Ver reemplazo/ })).not.toBeInTheDocument();
});
it("an original with an active replacement links to it", () => {
  render(<ReplacementLinkBar lifecycle={{ ...base, kind: "original", active_replacement_id: replacement }} selfId={original} />);
  expect(screen.getByText(/reemplazo en curso/)).toBeVisible();
  expect(screen.getByRole("link", { name: /Ver reemplazo/ })).toHaveAttribute("href", `/empresa/vacantes/${replacement}/pipeline`);
});

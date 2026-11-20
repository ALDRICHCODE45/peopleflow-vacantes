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

// R4 chain names (the board's single GET V/replacements, shared with the link bar).
const chain = [
  { id: original, kind: "original" as const, sequence: 0, title: "Supervisor(a) de Almacén", canOpen: true },
  { id: replacement, kind: "replacement" as const, sequence: 1, title: "Supervisor(a) de Almacén", canOpen: true },
];
it("names the replacement and its original from the chain", () => {
  render(<ReplacementLinkBar lifecycle={{ ...base, kind: "replacement", replacement_of: original }} selfId={replacement} chain={chain} />);
  expect(screen.getByText("Reemplazo 1")).toBeVisible();
  expect(screen.getByText(/de Supervisor\(a\) de Almacén/)).toBeVisible();
  expect(screen.getByRole("link", { name: /Ver original/ })).toHaveAttribute("href", `/empresa/vacantes/${original}/pipeline`);
});
it("names the active replacement the original points to", () => {
  render(<ReplacementLinkBar lifecycle={{ ...base, kind: "original", active_replacement_id: replacement }} selfId={original} chain={chain} />);
  const link = screen.getByRole("link", { name: "Ver reemplazo activo: Reemplazo 1" });
  expect(link).toHaveAttribute("href", `/empresa/vacantes/${replacement}/pipeline`);
});
it("a second replacement points back to the replacement it replaces by name", () => {
  const second = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d90";
  render(<ReplacementLinkBar lifecycle={{ ...base, kind: "replacement", replacement_of: replacement }} selfId={second}
    chain={[...chain, { id: second, kind: "replacement", sequence: 2, title: "Supervisor(a) de Almacén", canOpen: true }]} />);
  expect(screen.getByText("Reemplazo 2")).toBeVisible();
  expect(screen.getByRole("link", { name: "Ver Reemplazo 1" })).toHaveAttribute("href", `/empresa/vacantes/${replacement}/pipeline`);
});
it("without a link target the caller may not open there is only the sentence", () => {
  render(<ReplacementLinkBar lifecycle={{ ...base, kind: "original", active_replacement_id: replacement }} selfId={original} chain={[chain[0], { ...chain[1], canOpen: false }]} />);
  expect(screen.getByText("Reemplazo 1")).toBeVisible();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
it("a chain that does not name the process keeps today's copy and links", () => {
  render(<ReplacementLinkBar lifecycle={{ ...base, kind: "original", active_replacement_id: replacement }} selfId={original} chain={[chain[0]]} />);
  expect(screen.getByText(/reemplazo en curso/)).toBeVisible();
  expect(screen.getByRole("link", { name: /Ver reemplazo/ })).toHaveAttribute("href", `/empresa/vacantes/${replacement}/pipeline`);
});

// Departed hires (fallen credits of the chain) named in the bars.
const named = [
  { ...chain[0] },
  { ...chain[1], replaces: ["Ricardo Morales García"] },
];
it("replacement side: «Reemplaza a <nombre> en <título de la original>»", () => {
  render(<ReplacementLinkBar lifecycle={{ ...base, kind: "replacement", replacement_of: original }} selfId={replacement} chain={named} />);
  expect(screen.getByText("Reemplazo 1")).toBeVisible();
  expect(screen.getByText(/Reemplaza a Ricardo Morales García en Supervisor\(a\) de Almacén\./)).toBeVisible();
  expect(screen.queryByText(/Este proceso es el/)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Ver original/ })).toHaveAttribute("href", `/empresa/vacantes/${original}/pipeline`);
});
it("original side: «Reemplazo en curso para <nombre>: Reemplazo N»", () => {
  render(<ReplacementLinkBar lifecycle={{ ...base, kind: "original", active_replacement_id: replacement }} selfId={original} chain={named} />);
  const bar = screen.getByText(/Reemplazo en curso para Ricardo Morales García/);
  expect(bar).toHaveTextContent("Reemplazo en curso para Ricardo Morales García: Reemplazo 1.");
  expect(screen.getByRole("link", { name: "Ver reemplazo activo: Reemplazo 1" })).toBeVisible();
});
it("lists several departed hires with commas and «y»", () => {
  const many = [chain[0], { ...chain[1], replaces: ["Ana Ruiz", "Luis Pérez", "Marta Díaz"] }];
  render(<ReplacementLinkBar lifecycle={{ ...base, kind: "original", active_replacement_id: replacement }} selfId={original} chain={many} />);
  expect(screen.getByText(/Reemplazo en curso para Ana Ruiz, Luis Pérez y Marta Díaz/)).toBeVisible();
});
it("keeps the generic copy when the chain has no names for the process", () => {
  render(<ReplacementLinkBar lifecycle={{ ...base, kind: "replacement", replacement_of: original }} selfId={replacement} chain={[chain[0], { ...chain[1], replaces: [] }]} />);
  expect(screen.getByText(/Este proceso es el/)).toBeVisible();
  expect(screen.queryByText(/Reemplaza a/)).not.toBeInTheDocument();
});
it("tints the bar so it shows in dark mode too (brand tone, not the deep --primary fill)", () => {
  const { container } = render(<ReplacementLinkBar lifecycle={{ ...base, kind: "original", active_replacement_id: replacement }} selfId={original} chain={named} />);
  const bar = container.querySelector("[data-pf-replacement-links] > div");
  expect(bar).toHaveClass("dark:bg-brand-decorative-strong/10", "dark:border-brand-decorative-strong/30");
});

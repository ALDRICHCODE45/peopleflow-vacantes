import * as React from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TeamWorkspace } from "./team-workspace";
import { members, selfId } from "./test-fixtures";
afterEach(cleanup);
it("uses the installed shadcn menu trigger with entity name, native button and no own-row menu", () => {
  render(<TeamWorkspace members={members} role="owner" userId={selfId} onAction={() => {}} />);
  const trigger = screen.getByRole("button", { name: "Acciones de José Real" });
  expect(trigger.tagName).toBe("BUTTON");
  expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  expect(trigger).toHaveAttribute("data-slot", "dropdown-menu-trigger");
  expect(screen.queryByRole("button", { name: "Acciones de Ana Real" })).not.toBeInTheDocument();
});
it("does not render triggers for recruiters or missing identity", () => {
  const { rerender } = render(<TeamWorkspace members={members} role="recruiter" userId={selfId} onAction={() => {}} />);
  expect(screen.queryByRole("button", { name: /Acciones de/ })).not.toBeInTheDocument();
  rerender(<TeamWorkspace members={members} role="owner" userId={null} onAction={() => {}} />);
  expect(screen.queryByRole("button", { name: /Acciones de/ })).not.toBeInTheDocument();
});

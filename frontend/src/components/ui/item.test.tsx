import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Item, ItemContent, ItemGroup, ItemSeparator, ItemTitle } from "./item";

afterEach(cleanup);
it("rows inside an ItemGroup are list items and their separators are presentational", () => {
  render(<ItemGroup><Item><ItemContent><ItemTitle>Uno</ItemTitle></ItemContent></Item><ItemSeparator /><Item><ItemContent><ItemTitle>Dos</ItemTitle></ItemContent></Item></ItemGroup>);
  const list = screen.getByRole("list");
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(list.children).toHaveLength(3);
  expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  for (const child of list.children) expect(["listitem", "presentation"]).toContain(child.getAttribute("role"));
});
it("an explicit role wins and a standalone Item has none", () => {
  render(<><ItemGroup><Item role="group" aria-label="Fila" /></ItemGroup><Item data-testid="alone" /></>);
  expect(screen.getByRole("group", { name: "Fila" })).toBeInTheDocument();
  expect(screen.getByTestId("alone")).not.toHaveAttribute("role");
});
it("a separator outside a list keeps its separator role", () => {
  render(<ItemSeparator />);
  expect(screen.getByRole("separator")).toBeInTheDocument();
});

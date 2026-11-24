import { afterEach, expect, it } from "vitest";
import { createPortal } from "react-dom";
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
it("only direct rows are list items: a nested Item and an Item in a portal have no listitem role", () => {
  render(<ItemGroup><Item data-testid="row"><ItemContent><Item data-testid="nested" /></ItemContent>{createPortal(<Item data-testid="portaled" />, document.body)}</Item></ItemGroup>);
  expect(screen.getByTestId("row")).toHaveAttribute("role", "listitem");
  expect(screen.getByTestId("nested")).not.toHaveAttribute("role");
  expect(screen.getByTestId("portaled")).not.toHaveAttribute("role");
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
});
it("a separator nested inside a row stays a separator; a direct one is presentational", () => {
  render(<ItemGroup><Item><ItemSeparator /></Item><ItemSeparator data-testid="direct" /></ItemGroup>);
  expect(screen.getByRole("separator")).toBeInTheDocument();
  expect(screen.getByTestId("direct")).toHaveAttribute("role", "presentation");
});
it("an Item rendered as a link or button inside a group keeps its native role", () => {
  render(<ItemGroup><Item render={<a href="/x" />}>Enlace</Item><Item render={<button type="button" />}>Botón</Item><Item>Fila</Item></ItemGroup>);
  expect(screen.getByRole("link", { name: "Enlace" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Botón" })).toBeInTheDocument();
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
});
it("an Item rendered as a div inside a group is still a list item", () => {
  render(<ItemGroup><Item render={<div />}>Fila</Item></ItemGroup>);
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
});
it("a list only contains listitem or presentation children when rows are plain", () => {
  render(<ItemGroup><Item><Item /></Item><ItemSeparator /><Item /></ItemGroup>);
  for (const child of screen.getByRole("list").children) expect(["listitem", "presentation"]).toContain(child.getAttribute("role"));
  expect(screen.getByRole("list").querySelectorAll('[role="listitem"]')).toHaveLength(2);
});
it("a presentational separator in a list carries no aria-orientation; outside a list it keeps separator semantics", () => {
  const { unmount } = render(<ItemGroup><Item /><ItemSeparator data-testid="in-list" /><Item /></ItemGroup>);
  expect(screen.getByTestId("in-list")).toHaveAttribute("role", "presentation");
  expect(screen.getByTestId("in-list")).not.toHaveAttribute("aria-orientation");
  unmount();
  render(<ItemSeparator />);
  expect(screen.getByRole("separator")).toHaveAttribute("aria-orientation", "horizontal");
});
it("Items inside a native ul/li wrapper get no listitem role (ItemGroup role=presentation or list)", () => {
  render(<><ItemGroup role="presentation"><ul><li><Item data-testid="a">A</Item></li></ul></ItemGroup><ItemGroup><ul><li><Item data-testid="b">B</Item></li></ul></ItemGroup></>);
  expect(screen.getByTestId("a")).not.toHaveAttribute("role");
  expect(screen.getByTestId("b")).not.toHaveAttribute("role");
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
});
it("Items inside a fragment or a row component that are direct list children keep listitem", () => {
  const Row = () => <Item data-testid="row" />;
  render(<ItemGroup><><Item data-testid="frag" /></><Row />{[1, 2].map(n => <Item key={n} data-testid={`m${n}`} />)}</ItemGroup>);
  for (const id of ["frag", "row", "m1", "m2"]) expect(screen.getByTestId(id)).toHaveAttribute("role", "listitem");
});

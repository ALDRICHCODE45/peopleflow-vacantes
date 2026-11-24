import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

afterEach(cleanup);

// Local fix (approved by the user 2026-10-20, rule §19): the registry Tabs only set
// data-orientation; Base UI must receive `orientation` so the list is truly vertical.
it("forwards orientation to Base UI so vertical tabs are announced and navigated vertically", () => {
  render(<Tabs orientation="vertical" defaultValue="a"><TabsList><TabsTrigger value="a">A</TabsTrigger><TabsTrigger value="b">B</TabsTrigger></TabsList><TabsContent value="a">Panel A</TabsContent></Tabs>);
  expect(screen.getByRole("tablist")).toHaveAttribute("aria-orientation", "vertical");
});

it("keeps horizontal as the default orientation", () => {
  render(<Tabs defaultValue="a"><TabsList><TabsTrigger value="a">A</TabsTrigger></TabsList></Tabs>);
  expect(screen.getByRole("tablist")).not.toHaveAttribute("aria-orientation", "vertical");
});

// axe color-contrast: count badges inside a TabsList took text-muted-foreground (#6b6480) on a 6% foreground tint (#e4e1ea) = 4.32:1.
// The list now paints them text-foreground/75 (6.8:1 light, 7.9:1 dark) so every Tabs user passes without a call-site override.
it("paints count badges inside the segmented list with a >=4.5:1 foreground mix, not muted-foreground", () => {
  render(<Tabs defaultValue="a"><TabsList><TabsTrigger value="a">A</TabsTrigger></TabsList></Tabs>);
  const list = screen.getByRole("tablist").className;
  expect(list).toContain("[&_[data-slot=badge]]:text-foreground/75");
  expect(list).not.toContain("[&_[data-slot=badge]]:text-muted-foreground");
});

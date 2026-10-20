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

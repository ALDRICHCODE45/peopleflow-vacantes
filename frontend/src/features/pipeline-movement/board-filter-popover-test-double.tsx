import { cloneElement, createContext, useContext, useState, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { vi } from "vitest";

// Anchored Base UI positioning loops under jsdom (see ui/combobox.test.tsx).
// Only isolate the popup primitive: application content and real Sheet/Checkbox
// remain under test. Geometry and popup focus/dismissal require browser review.
vi.mock("@/components/ui/popover", async importOriginal => {
  const actual = await importOriginal<typeof import("@/components/ui/popover")>();
  const Open = createContext({ open: false, toggle: () => {} });
  return {
    ...actual,
    Popover: ({ children }: ComponentProps<typeof actual.Popover>) => {
      const [open, setOpen] = useState(false);
      return <Open.Provider value={{ open, toggle: () => setOpen(value => !value) }}>{children as ReactNode}</Open.Provider>;
    },
    PopoverTrigger: ({ render, children }: ComponentProps<typeof actual.PopoverTrigger>) => {
      const { open, toggle } = useContext(Open);
      return cloneElement(render as ReactElement<Record<string, unknown>>, { onClick: toggle, "aria-expanded": open, "data-slot": "popover-trigger" }, children);
    },
    PopoverContent: ({ children }: ComponentProps<typeof actual.PopoverContent>) => useContext(Open).open ? <div>{children}</div> : null,
  };
});

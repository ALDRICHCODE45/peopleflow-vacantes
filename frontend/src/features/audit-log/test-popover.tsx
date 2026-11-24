import * as React from "react";

/**
 * Controlled stand-in for `@/components/ui/popover` in jsdom: the real Base UI popover refocus-loops on close under jsdom (same
 * boundary as date-picker-field.test). The panels, the shared DatePickerField and the real Calendar stay in play; the shared
 * primitive and the browser checks own positioning. Use with
 * `vi.mock("@/components/ui/popover", async () => (await import("./test-popover")).popoverModule())`.
 */
const Context = React.createContext<{ open: boolean; setOpen: (next: boolean) => void }>({ open: false, setOpen: () => {} });

export function popoverModule() {
  return {
    Popover: ({ open, onOpenChange, children }: { open?: boolean; onOpenChange?: (next: boolean) => void; children?: React.ReactNode }) =>
      <Context.Provider value={{ open: Boolean(open), setOpen: next => onOpenChange?.(next) }}>{children}</Context.Provider>,
    PopoverTrigger: ({ render }: { render: React.ReactElement<{ onClick?: () => void }> }) => {
      const { open, setOpen } = React.useContext(Context);
      return React.cloneElement(render, { onClick: () => setOpen(!open), "aria-expanded": open } as object);
    },
    PopoverContent: ({ children, className, ...props }: React.ComponentProps<"div">) =>
      React.useContext(Context).open ? <div role="dialog" data-class={className} {...props}>{children}</div> : null,
    PopoverHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    PopoverTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
    PopoverDescription: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>,
  };
}

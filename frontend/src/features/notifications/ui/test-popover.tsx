import * as React from "react";

/**
 * Controlled stand-in for `@/components/ui/popover` in jsdom: the real Base UI popover refocus-loops under jsdom (same
 * boundary as audit-log/test-popover and date-picker-field.test), and here it hangs `user.click` on the trigger. The
 * popup renders inline as a `dialog` named by its title. Use with
 * `vi.mock("@/components/ui/popover", async () => (await import("./test-popover")).popoverModule())`.
 */
type Ctx = { open: boolean; setOpen: (next: boolean) => void; titleId: string };
const Context = React.createContext<Ctx>({ open: false, setOpen: () => {}, titleId: "" });

export function popoverModule() {
  return {
    Popover: ({ open, onOpenChange, children }: { open?: boolean; onOpenChange?: (next: boolean) => void; children?: React.ReactNode }) => {
      const titleId = React.useId();
      return <Context.Provider value={{ open: Boolean(open), setOpen: next => onOpenChange?.(next), titleId }}>{children}</Context.Provider>;
    },
    PopoverTrigger: ({ render, children }: { render: React.ReactElement<{ onClick?: () => void }>; children?: React.ReactNode }) => {
      const { open, setOpen } = React.useContext(Context);
      return React.cloneElement(render, { onClick: () => setOpen(!open), "aria-expanded": open, "aria-haspopup": "dialog" } as object, children);
    },
    PopoverContent: ({ children, className }: { children?: React.ReactNode; className?: string }) => {
      const { open, titleId } = React.useContext(Context);
      return open ? <div role="dialog" aria-labelledby={titleId} data-class={className}>{children}</div> : null;
    },
    PopoverHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    PopoverTitle: ({ children }: { children?: React.ReactNode }) => <h2 id={React.useContext(Context).titleId}>{children}</h2>,
    PopoverDescription: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>,
  };
}

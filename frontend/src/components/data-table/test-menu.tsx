// Deterministic controller double: Base UI positioning cannot settle in jsdom (design rules §13.7).
import * as React from "react";
const Context = React.createContext({ open: false, setOpen: (open: boolean) => { void open; } });
export const menuDouble = {
  DropdownMenu: ({ children }: { children: React.ReactNode }) => {
    const [open, setOpen] = React.useState(false);
    return <Context.Provider value={{ open, setOpen }}>{children}</Context.Provider>;
  },
  DropdownMenuTrigger: ({ render, children }: { render: React.ReactElement<React.ComponentProps<"button">>; children: React.ReactNode }) => {
    const { open, setOpen } = React.useContext(Context);
    return React.cloneElement(render, { "aria-haspopup": "menu", "aria-expanded": open, onClick: () => setOpen(!open), children });
  },
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => React.useContext(Context).open ? <div role="menu">{children}</div> : null,
  DropdownMenuGroup: ({ children }: { children: React.ReactNode }) => <div role="group">{children}</div>,
  DropdownMenuSeparator: () => <div role="separator" />,
  DropdownMenuItem: ({ onClick, disabled, render, ...props }: React.ComponentProps<"button"> & { render?: React.ReactElement<React.ComponentProps<"button">> }) => {
    const { setOpen } = React.useContext(Context);
    const itemProps: React.ComponentProps<"button"> = { ...props, disabled, "aria-disabled": disabled || undefined, role: "menuitem", onClick: event => { onClick?.(event); setOpen(false); } };
    return render ? React.cloneElement(render, itemProps) : <button {...itemProps} />;
  },
  DropdownMenuCheckboxItem: ({ checked, onCheckedChange, closeOnClick: _closeOnClick, ...props }: Omit<React.ComponentProps<"button">, "onChange"> & { checked: boolean; onCheckedChange: (value: boolean) => void; closeOnClick?: boolean }) =>
    { void _closeOnClick; return <button {...props} role="menuitemcheckbox" aria-checked={checked} onClick={() => onCheckedChange(!checked)} />; },
};

const TooltipContext = React.createContext({ open: false, setOpen: (open: boolean) => { void open; } });
export const tooltipDouble = {
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => {
    const [open, setOpen] = React.useState(false);
    return <TooltipContext.Provider value={{ open, setOpen }}>{children}</TooltipContext.Provider>;
  },
  TooltipTrigger: ({ render, ...props }: { render: React.ReactElement<React.ComponentProps<"span">>; tabIndex?: number }) => {
    const { setOpen } = React.useContext(TooltipContext);
    return React.cloneElement(render, { ...props, onFocus: () => setOpen(true), onMouseEnter: () => setOpen(true) });
  },
  TooltipContent: ({ children }: { children: React.ReactNode }) => React.useContext(TooltipContext).open ? <div role="tooltip">{children}</div> : null,
};

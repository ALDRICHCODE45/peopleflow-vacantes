import { cloneElement, createContext, useContext, useState, type ComponentProps, type ReactElement, type ReactNode } from "react";

/**
 * Test doubles for the two Base UI anchored popups (combobox, dropdown menu). Under jsdom their portal popup repositions in an update
 * loop that never returns (see `components/ui/combobox.test.tsx`); the repo's convention is to replace only that boundary and keep the
 * product composition (labels, option lists, controlled changes, menu items).
 */
type Entry = Record<string, unknown>;
type ComboState = { items: Entry[]; value: Entry | null; change: (item: Entry | null) => void; label: (item: Entry) => string; disabled: boolean; open: boolean; setOpen: (open: boolean) => void };
const Combo = createContext<ComboState | null>(null);

export const comboboxDouble = () => ({
  Combobox: ({ items, value, onValueChange, itemToStringLabel, disabled = false, children }: { items: Entry[]; value: Entry | null; onValueChange: (item: Entry | null) => void; itemToStringLabel: (item: Entry) => string; disabled?: boolean; children: ReactNode }) => {
    const [open, setOpen] = useState(false);
    return <Combo.Provider value={{ items, value, change: onValueChange, label: itemToStringLabel, disabled, open, setOpen }}>{children}</Combo.Provider>;
  },
  ComboboxInput: ({ id, placeholder, disabled, "aria-label": label }: { id?: string; placeholder?: string; disabled?: boolean; "aria-label"?: string }) => {
    const state = useContext(Combo)!;
    return <input id={id} role="combobox" aria-expanded={state.open} aria-controls="double-list" aria-label={label} placeholder={placeholder} disabled={disabled} readOnly value={state.value ? state.label(state.value) : ""} onClick={() => state.setOpen(true)} />;
  },
  ComboboxContent: ({ children }: { children: ReactNode }) => useContext(Combo)!.open ? <div>{children}</div> : null,
  ComboboxEmpty: () => null,
  ComboboxList: ({ children }: { children: (item: Entry) => ReactNode }) => <ul role="listbox" id="double-list">{useContext(Combo)!.items.map(item => children(item))}</ul>,
  ComboboxItem: ({ value, disabled, children }: { value: Entry; disabled?: boolean; children: ReactNode }) => {
    const state = useContext(Combo)!;
    return <li role="option" aria-selected={state.value === value} aria-disabled={disabled || undefined} onClick={() => { if (disabled) return; state.change(value); state.setOpen(false); }}>{children}</li>;
  },
  useComboboxAnchor: () => ({ current: null }),
});

const Menu = createContext<{ open: boolean; toggle: () => void }>({ open: false, toggle: () => {} });
export const dropdownMenuDouble = () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => { const [open, setOpen] = useState(false); return <Menu.Provider value={{ open, toggle: () => setOpen(value => !value) }}>{children}</Menu.Provider>; },
  DropdownMenuTrigger: ({ render, children }: { render: ReactElement<ComponentProps<"button">>; children: ReactNode }) => {
    const menu = useContext(Menu);
    return cloneElement(render, { "aria-haspopup": "menu", "aria-expanded": menu.open, onClick: menu.toggle, children } as ComponentProps<"button">);
  },
  DropdownMenuContent: ({ children }: { children: ReactNode }) => useContext(Menu).open ? <div role="menu">{children}</div> : null,
  DropdownMenuItem: ({ children, onClick, disabled }: ComponentProps<"button">) => { const menu = useContext(Menu); return <button role="menuitem" disabled={disabled} onClick={event => { menu.toggle(); onClick?.(event); }}>{children}</button>; },
});

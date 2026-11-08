import * as React from "react";
import { vi } from "vitest";
import type { MetricsFailure } from "@/features/company-metrics/model";
import type { SectionState } from "@/features/company-metrics/use-section";

/** Same boundary as the metrics tests: the real Base UI popover close path refocus-loops under jsdom. */
export function popoverMock() {
  const Context = React.createContext<{ open: boolean; setOpen: (next: boolean) => void }>({ open: false, setOpen: () => {} });
  return {
    Popover: ({ open, onOpenChange, children }: { open?: boolean; onOpenChange?: (next: boolean) => void; children?: React.ReactNode }) =>
      <Context.Provider value={{ open: Boolean(open), setOpen: next => onOpenChange?.(next) }}>{children}</Context.Provider>,
    PopoverTrigger: ({ render, children }: { render: React.ReactElement<{ onClick?: () => void; children?: React.ReactNode }>; children?: React.ReactNode }) => {
      const { open, setOpen } = React.useContext(Context);
      return React.cloneElement(render, { onClick: () => setOpen(!open), ...(children ? { children } : {}) });
    },
    PopoverContent: ({ children }: { children?: React.ReactNode }) => React.useContext(Context).open ? <div role="dialog">{children}</div> : null,
    PopoverTitle: ({ children }: { children?: React.ReactNode }) => <h4>{children}</h4>,
    PopoverDescription: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  };
}

const base = { ref: vi.fn(), retry: vi.fn(), activate: vi.fn() };
export const ready = <T,>(data: T, stale = false): SectionState<T> => ({ status: "ready", data, stale, failure: null, ...base, retry: vi.fn() });
export const loading = (): SectionState<never> => ({ status: "loading", data: null, stale: false, failure: null, ...base });
export const failed = (failure: MetricsFailure = { ok: false, reason: "server_error", reference: {} }): SectionState<never> =>
  ({ status: "failed", data: null, stale: false, failure, ...base, retry: vi.fn() });

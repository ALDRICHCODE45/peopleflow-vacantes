"use client";

import { createContext, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { ActionStatus } from "@/components/feedback/action-status";
import type { Lifecycle } from "@/features/vacancy-lifecycle/model";

const Context = createContext<{ lifecycle?: Lifecycle; update: (value: Lifecycle) => void } | null>(null);
function latest(...values: (Lifecycle | undefined)[]): Lifecycle | undefined {
  return values.reduce<Lifecycle | undefined>((current, next) => !next ? current : !current || BigInt(next.version) >= BigInt(current.version) ? next : current, undefined);
}
/** Shares authoritative lifecycle across configuration tabs, never the content editor. */
export function ConfigLifecycleProvider({ lifecycle, children }: { lifecycle: Lifecycle; children: ReactNode }) {
  const [fresh, setFresh] = useState<Lifecycle>();
  return <Context.Provider value={{ lifecycle: latest(lifecycle, fresh), update: value => setFresh(previous => latest(previous, value)) }}>{children}</Context.Provider>;
}
export function useConfigLifecycle(initial?: Lifecycle) {
  const shared = useContext(Context);
  const [fresh, setFresh] = useState<Lifecycle>();
  const lifecycle = latest(initial, shared?.lifecycle, fresh);
  useEffect(() => {
    if (initial && shared && (!shared.lifecycle || BigInt(initial.version) > BigInt(shared.lifecycle.version))) shared.update(initial);
  }, [initial, shared]);
  return {
    lifecycle,
    readOnly: lifecycle?.process === "finished",
    updateLifecycle(value: Lifecycle) {
      setFresh(previous => latest(previous, value));
      shared?.update(value);
    },
  };
}
export function ConfigReadOnlyNotice() {
  const id = useId();
  return <ActionStatus id={id} tone="info" text="El proceso de esta vacante finalizó. La configuración está en solo lectura." />;
}

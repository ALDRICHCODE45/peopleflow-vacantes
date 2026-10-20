"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { LogOut } from "lucide-react";
import { ConfirmActionDialog } from "@/components/feedback/confirm-action-dialog";

const sentinelKey = "__draftLeaveGuard";
let nextOwner = 0;

/** Capture links and use a same-URL history sentinel without patching any APIs.
 * This Back workaround is not officially supported by the App Router. External
 * history changes (including multi-entry jumps/imperative routing) can bypass it;
 * only a still-current, owned sentinel is safe to remove. Browser testing matters.
 * Releasing moves back past the sentinel but browsers cannot delete it: it stays as a
 * forward entry until the next push replaces it (accepted: Back always leaves in one step).
 */
export type DraftLeaveGuardHandle = {
  /** False means traversal timed out: do not replace the URL on that entry. */
  releaseSentinel(): Promise<boolean>;
  protect(): void;
};

export function DraftLeaveGuard({ dirty, ref }: { dirty: boolean; ref?: Ref<DraftLeaveGuardHandle> }) {
  const [destination, setDestination] = useState<HTMLAnchorElement | null>(null);
  const permitted = useRef(false);
  const [backRequested, setBackRequested] = useState(false);
  const owner = useRef<string | null>(null);
  const active = useRef(false);
  const clean = useRef(!dirty);
  const leavingBack = useRef(false);
  const released = useRef(false);
  const releasing = useRef<Promise<boolean> | null>(null);
  const protectRef = useRef(() => {});
  const releaseSentinel = () => {
    if (releasing.current) return releasing.current;
    released.current = true;
    if (history.state?.[sentinelKey] !== owner.current) return Promise.resolve(true);
    const promise = new Promise<boolean>(resolve => {
      const finish = () => {
        window.clearTimeout(timer);
        window.removeEventListener("popstate", finish);
        resolve(history.state?.[sentinelKey] !== owner.current);
      };
      // Never replace a still-current sentinel on timeout: that strands /nuevo
      // behind the saved URL. The save flow retains the pending URL for retry.
      const timer = window.setTimeout(finish, 1000);
      window.addEventListener("popstate", finish);
      history.go(-1);
    });
    releasing.current = promise;
    void promise.then(() => { releasing.current = null; });
    return promise;
  };
  useImperativeHandle(ref, () => ({ releaseSentinel, protect: () => protectRef.current() }));
  if (!dirty && (destination !== null || backRequested)) {
    setDestination(null);
    setBackRequested(false);
  }
  useEffect(() => {
    clean.current = !dirty;
    if (!dirty) return;
    active.current = true;
    permitted.current = false;
    leavingBack.current = false;
    released.current = false;
    owner.current ??= `${Date.now()}-${++nextOwner}`;
    const readUrl = () => ({ pathname: location.pathname, search: location.search, hash: location.hash });
    let currentUrl = readUrl();
    const ownsCurrentEntry = () => history.state?.[sentinelKey] === owner.current;
    function pushSentinel() {
      history.pushState(history.state, "", location.href);
      history.replaceState({ ...history.state, [sentinelKey]: owner.current }, "", location.href);
    }
    protectRef.current = () => {
      released.current = false;
      currentUrl = readUrl();
      if (!ownsCurrentEntry()) pushSentinel();
    };
    protectRef.current();
    function pop() {
      if (permitted.current || released.current || releasing.current) return;
      const nextUrl = readUrl();
      if (nextUrl.pathname === currentUrl.pathname && nextUrl.search === currentUrl.search && nextUrl.hash !== currentUrl.hash) {
        currentUrl = nextUrl;
        return;
      }
      pushSentinel();
      setDestination(null);
      setBackRequested(true);
    }
    function unload(event: BeforeUnloadEvent) {
      if (permitted.current) return;
      event.preventDefault(); event.returnValue = "";
    }
    function follow(event: MouseEvent) {
      if (permitted.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.download || (link.target && link.target !== "_self") || link.origin !== location.origin) return;
      if (link.pathname === location.pathname && link.search === location.search) return;
      event.preventDefault(); event.stopPropagation(); setBackRequested(false); setDestination(link);
    }
    window.addEventListener("popstate", pop);
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", follow, true);
    return () => {
      active.current = false;
      window.removeEventListener("popstate", pop);
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", follow, true);
      // Defer to survive StrictMode's effect replay without adding a second entry.
      queueMicrotask(() => {
        if (!active.current && (clean.current || permitted.current) && !leavingBack.current && !released.current && ownsCurrentEntry()) void releaseSentinel();
      });
    };
  }, [dirty]);
  return <ConfirmActionDialog open={(destination !== null || backRequested) && dirty} onOpenChange={open => { if (!open) { setDestination(null); setBackRequested(false); } }}
    icon={LogOut} title="Tienes cambios sin guardar" description="Si sales ahora, perderás los cambios que no guardaste."
    cancelLabel="Continuar editando" confirmLabel="Salir de todos modos" tone="destructive" finalFocus={() => destination}
    onConfirm={() => {
      if (permitted.current) return;
      const link = destination; setDestination(null);
      permitted.current = true;
      if (backRequested) {
        setBackRequested(false);
        leavingBack.current = true;
        history.go(-2);
        return;
      }
      link?.click();
      // Only this confirmed navigation may bypass the guard, not later edits.
      window.setTimeout(() => { permitted.current = false; }, 0);
    }} />;
}

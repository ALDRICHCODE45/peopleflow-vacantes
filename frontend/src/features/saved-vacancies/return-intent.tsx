"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useIdentity } from "@/features/identity/identity-session";
import type { Identity } from "@/features/identity/model";
import { jobIdSchema } from "./model";
import { CandidateControl } from "./save-control";

// Shared across StrictMode replays; reloads replay the backend's idempotent PUT.
const returnSavesInFlight = new Set<string>();

function subscribeLocation(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}
const hasReturnIntent = () => new URLSearchParams(window.location.search).has("guardar");
const noServerIntent = () => false;

/** Mount once at page level. Unresolved/isolated islands need no router provider. */
export function SavedJobReturnIntent() {
  const identity = useIdentity();
  // Recheck on hydration, page rerenders and browser Back/Forward. No router is
  // needed for ordinary detail renders, including isolated client islands.
  const hasIntent = useSyncExternalStore(subscribeLocation, hasReturnIntent, noServerIntent);
  return identity.status === "loading" || !hasIntent ? null : <ResolvedReturnIntent identity={identity} />;
}

function ResolvedReturnIntent({ identity }: { identity: ReturnType<typeof useIdentity> }) {
  const router = useRouter();
  const params = useSearchParams();
  const [claimed, setClaimed] = useState<{ jobId: string; identity: Identity; settled: () => void }>();
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    if (!search.has("guardar")) return;
    const values = search.getAll("guardar");
    const pathname = window.location.pathname;
    function clearIntent() {
      const current = new URLSearchParams(window.location.search);
      if (window.location.pathname !== pathname || current.getAll("guardar").join("\0") !== values.join("\0")) return;
      current.delete("guardar");
      const clean = `${pathname}${current.size ? `?${current}` : ""}${window.location.hash}`;
      window.history.replaceState(window.history.state, "", clean);
      router.replace(clean, { scroll: false });
    }
    if (identity.status === "ready" && identity.result?.ok && identity.result.data.role === "candidate"
      && values.length === 1 && jobIdSchema.safeParse(values[0]).success) {
      const jobId = values[0];
      if (returnSavesInFlight.has(jobId)) return;
      returnSavesInFlight.add(jobId);
      setClaimed({ jobId, identity: identity.result.data, settled: () => {
        clearIntent();
        returnSavesInFlight.delete(jobId);
      } });
    } else clearIntent();
  }, [identity, params, router]);
  return claimed && identity.status === "ready" && identity.result?.ok && identity.result.data === claimed.identity
    ? <CandidateControl jobId={claimed.jobId} title="vacante" identity={claimed.identity} returnIntent={claimed.settled} /> : null;
}

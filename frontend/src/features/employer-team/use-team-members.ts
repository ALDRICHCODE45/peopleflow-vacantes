"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listTeamMembersAction, type TeamListResult } from "./actions";

/** Cancel stale reads on unmount and discard out-of-order results. The caller keys by identity. */
export function useTeamMembers() {
  const [state, setState] = useState<{ result: TeamListResult | null; pending: boolean }>({ result: null, pending: true });
  const sequence = useRef(0);
  const mounted = useRef(false);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    setState(previous => ({ ...previous, pending: true }));
    const result = await listTeamMembersAction().catch((): TeamListResult => ({ ok: false, reason: "no_response", reference: {} }));
    if (mounted.current && sequence.current === request) setState({ pending: false, result });
    return result;
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; sequence.current++; };
  }, [refresh]);
  return { ...state, refresh };
}

"use client";

import { useState } from "react";
import { createFixtureClient } from "./client";
import { AssignmentHistory } from "./history";

export function AssignmentHistoryPage() {
  const [client] = useState(() => {
    const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
    const state = params.get("state");
    const scenario = state === "error" || state === "loading" ? state : params.get("fixture") === "empty" ? "empty" : "default";
    // TODO: plug in GET /v2/me/vacancy-assignments/history for flag=api when the endpoint lands; both opt-ins use fixtures until then.
    return createFixtureClient(scenario);
  });
  return <AssignmentHistory client={client} />;
}

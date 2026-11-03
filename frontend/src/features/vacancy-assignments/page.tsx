"use client";

import { useState } from "react";
import { createFixtureClient } from "./client";
import { AssignmentHistory } from "./history";
import { createApiClient } from "./action-client";
import { teamDataSource } from "@/features/vacancy-team/model";

export function AssignmentHistoryPage() {
  const [client] = useState(() => {
    const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
    const state = params.get("state");
    const scenario = state === "error" || state === "loading" ? state : params.get("fixture") === "empty" ? "empty" : "default";
    const mode = teamDataSource(process.env.NODE_ENV, process.env.NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE);
    return mode === "api" ? createApiClient() : mode === "fixture" ? createFixtureClient(scenario) : null;
  });
  return client ? <AssignmentHistory client={client} /> : null;
}

"use client";
import { useMemo } from "react";
import { createApiClient } from "./action-client";
import { TeamView } from "./team-view";
export function TeamApi({ vacancyId }: { vacancyId: string }) {
  const client = useMemo(() => createApiClient(vacancyId), [vacancyId]);
  return <TeamView key={vacancyId} client={client} writesAvailable={false} />;
}

"use client";
import { useState } from "react";
import { CircleAlert } from "lucide-react";
import { StateCard } from "@/components/feedback/state-card";
import { createFixtureClient } from "./prototype-client";
import { TeamView } from "./team-view";
import { TeamSkeleton } from "./loading";
import type { FixtureName } from "./model";

export function TeamPrototype({ fixture, state }: { fixture: FixtureName; state?: string }) {
  const [client] = useState(() => createFixtureClient(fixture));
  const [showError, setShowError] = useState(state === "error");
  if (state === "loading") return <TeamSkeleton />;
  if (showError) return <StateCard icon={CircleAlert} tone="error" title="No pudimos cargar el equipo" description="Tus datos no cambiaron. Reintenta para consultar el equipo y sus movimientos." primaryAction={{ label: "Reintentar", onClick: () => setShowError(false) }} />;
  return <TeamView client={client} />;
}

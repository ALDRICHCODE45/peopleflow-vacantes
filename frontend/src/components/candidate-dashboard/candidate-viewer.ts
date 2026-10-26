"use client";

import { useIdentity } from "@/features/identity/identity-session";

export function useCandidateViewer() {
  const { status, result } = useIdentity();
  if (status === "loading") return "loading";
  if (status === "unauthenticated" || !result?.ok) return "visitor";
  return result.data.role ?? "pending";
}

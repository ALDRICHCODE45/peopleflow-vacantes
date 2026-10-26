import type { ReactNode } from "react";
import { CandidateGuard } from "@/features/identity/area-guards";

/** Only private candidate destinations require a verified candidate account. */
export default function PrivateCandidateLayout({ children }: { children: ReactNode }) {
  return <CandidateGuard>{children}</CandidateGuard>;
}

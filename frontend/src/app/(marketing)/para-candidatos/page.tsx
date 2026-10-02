import { permanentRedirect } from "next/navigation";

/** Preserve previously shared links while keeping a single canonical landing. */
export default function LegacyCandidateMarketingPage() {
  permanentRedirect("/candidatos");
}

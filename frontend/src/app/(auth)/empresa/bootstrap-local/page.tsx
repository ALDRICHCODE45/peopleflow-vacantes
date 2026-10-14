import type { Metadata } from "next";

import { BootstrapLocalPanel } from "./bootstrap-local-panel";

export const metadata: Metadata = {
  title: "Bootstrap local de identidad",
  robots: { index: false, follow: false },
};

/**
 * Temporary local-only page for the TMP-IDENTITY-001 identity bootstrap. It is
 * deliberately not linked from navigation and never renders profile data.
 */
export default function BootstrapLocalPage() {
  return <BootstrapLocalPanel />;
}

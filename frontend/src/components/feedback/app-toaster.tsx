"use client";

import { Toaster, type SileoOptions } from "sileo";

// CSS tokens follow the existing document theme, including manual overrides.
// Pin Sileo's internal theme to avoid a second OS-theme listener; our scoped
// CSS and fill token own both schemes, including a manual choice over the OS.
const options: Partial<SileoOptions> = {
  fill: "var(--popover)",
  duration: 6000,
};

/** One app-wide host. Notifications are emitted only by confirmed user outcomes. */
export function AppToaster() {
  return (
    <div data-pf-toaster="">
      <Toaster position="top-right" theme="light" options={options} />
    </div>
  );
}

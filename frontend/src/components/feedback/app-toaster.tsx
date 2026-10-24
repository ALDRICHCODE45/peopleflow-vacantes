"use client";

import { Toaster, type SileoOptions } from "sileo";

import { useToastPlacement } from "./use-toast-placement";

// CSS tokens follow the existing document theme, including manual overrides.
// Pin Sileo's internal theme to avoid a second OS-theme listener; our scoped
// CSS and fill token own both schemes, including a manual choice over the OS.
const options: Partial<SileoOptions> = {
  fill: "var(--popover)",
  duration: 6000,
};

/** One app-wide host. Notifications are emitted only by confirmed user outcomes. */
export function AppToaster() {
  const placement = useToastPlacement();
  return (
    <div data-pf-toaster="" style={placement}>
      <Toaster position="bottom-right" theme="light" options={options} />
    </div>
  );
}

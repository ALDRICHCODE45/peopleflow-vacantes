"use client";

/** Event-only navigation keeps public control islands independent of router context. */
export function navigateSavedJob(href: string) {
  window.location.assign(href);
}

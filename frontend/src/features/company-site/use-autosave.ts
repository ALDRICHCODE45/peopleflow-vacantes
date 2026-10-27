"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { AutosaveController } from "./autosave";

/** Pass a stable session controller. Its owner disposes it when the editor session ends. */
export function useAutosave(controller: AutosaveController) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => controller.attachOnline(window), [controller]);
  return snapshot;
}

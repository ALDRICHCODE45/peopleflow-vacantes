import { savedJobErrorCopy } from "../feedback";
import type { SavedJobsFailure } from "../model";

/** Workspace-specific cause titles (§12); domain and session copy stays shared with cards. */
export function workspaceErrorCopy(error: SavedJobsFailure, removing: boolean) {
  const copy = savedJobErrorCopy(error, removing);
  if (error.reason === "server_error") return { ...copy, title: "El servidor tuvo un problema" };
  if (error.reason === "no_response") return { ...copy, title: "No hubo respuesta del servidor" };
  return copy;
}

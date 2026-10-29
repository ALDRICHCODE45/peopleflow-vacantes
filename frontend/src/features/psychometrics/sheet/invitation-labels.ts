import { statusLabels } from "../labels";
/** Invitation grammar matches the validated pipeline artboard; result labels stay unchanged. */
export const invitationStatusLabels = { ...statusLabels, expired: "Vencida", revoked: "Revocada" };

/** UI affordance only. The server remains the publication authorization boundary. */
export function canPublish(role: unknown): boolean { return role === "owner"; }
export const RECRUITER_PUBLISH_REASON = "Solo la persona dueña de la empresa puede publicar. Tus cambios quedan guardados en el borrador.";

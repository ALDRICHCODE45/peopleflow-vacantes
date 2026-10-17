import type { CvFailure } from "./model";
export const storageUnavailableCopy = { title: "Los CVs no están disponibles en este momento", description: "Puedes intentarlo más tarde; lo que ya escribiste se conserva." };
export function failureStatus(failure: CvFailure, copy: { title: string; description: string }): string {
  return failure.reason === "storage_unavailable" ? `${copy.title}. ${copy.description}` : copy.title;
}
export function uncertain(failure: CvFailure): boolean { return ["server_error", "no_response", "unrecognized_response"].includes(failure.reason); }
export function failureCopy(failure: CvFailure, max = 10, write: "upload" | "edit" | "read" = "read"): { title: string; description: string } {
  switch (failure.reason) {
    case "storage_unavailable": return storageUnavailableCopy;
    case "wrong_role": return { title: "Esta cuenta es de empresa", description: "Una cuenta tiene un solo rol. Para usar otra área necesitas una cuenta con otro email." };
    case "cv_too_large": return { title: "El archivo es demasiado grande", description: "El archivo pesa más de 5 MB." };
    case "cv_unsupported_type": return { title: "Formato no compatible", description: "Sube un PDF o un documento de Word (.docx)." };
    case "cv_content_mismatch": return { title: "Revisa el formato del archivo", description: "El archivo no coincide con su formato. Expórtalo de nuevo como PDF o Word." };
    case "cv_library_full": return { title: "Tu biblioteca está llena", description: `Ya tienes ${max} CVs. Elimina uno para subir otro.` };
    case "unauthenticated": return { title: "Tu sesión expiró", description: "Inicia sesión como candidato. Lo que estás editando se conserva en esta pantalla." };
    case "forbidden": return { title: "No tienes permiso para esta acción", description: "Usa una cuenta de candidato para administrar tus CVs." };
    case "not_found": return { title: "Este CV ya no está", description: "Actualiza la biblioteca para ver los documentos disponibles." };
    case "invalid_request": return { title: "Revisa los datos marcados", description: "Revisa el nombre y el archivo antes de volver a intentarlo." };
    default: {
      const title = failure.reason === "no_response" ? "No hubo respuesta del servidor" : failure.reason === "server_error" ? "El servidor tuvo un problema" : "No pudimos confirmar el resultado";
      return { title, description: write === "upload" ? "Comprueba tu biblioteca antes de volver a subirlo: reintentar puede crear otro CV." : write === "edit" ? "El cambio pudo haberse realizado. Comprueba tu biblioteca antes de volver a intentarlo." : "Tus documentos no se han modificado. Puedes volver a cargar la biblioteca." };
    }
  }
}
